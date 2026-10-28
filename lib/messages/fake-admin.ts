/**
 * An in-memory stand-in for the service-role Supabase client. Tests only.
 * It supports the query shapes the send workflow uses.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  private counter = 0;
  /** Columns a table rejects, to mimic a database that has not applied a migration. */
  missingColumns: Record<string, string[]> = {};
  /** The next N inserts into a table fail, to mimic a momentary database error. */
  failInserts: Record<string, number> = {};
  /** Column sets that must be unique per table, to mimic unique indexes. */
  uniqueKeys: Record<string, string[][]> = {};

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  seed(name: string, rows: Row[]): void {
    for (const row of rows) this.table(name).push({ ...row });
  }

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  from(name: string): FakeQuery {
    return new FakeQuery(this, name);
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private filtered: string[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private wantsOne: "single" | "maybe" | null = null;

  constructor(
    private db: FakeDb,
    private name: string
  ) {}

  select(_columns?: string): this {
    void _columns;
    return this;
  }
  insert(payload: Row | Row[]): this {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row): this {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filtered.push(column);
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push((row) => (value === null ? row[column] == null : row[column] === value));
    return this;
  }
  not(column: string, _op: string, value: unknown): this {
    void _op;
    this.filters.push((row) => (value === null ? row[column] != null : row[column] !== value));
    return this;
  }
  gt(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column] ?? "") > String(value));
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column] ?? "") >= String(value));
    return this;
  }
  like(column: string, pattern: string): this {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, "[\\s\\S]*").replace(/_/g, "[\\s\\S]");
    const expression = new RegExp(`^${escaped}$`);
    this.filters.push((row) => expression.test(String(row[column] ?? "")));
    return this;
  }
  or(_expr: string): this {
    void _expr;
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(count: number): this {
    this.max = count;
    return this;
  }
  single(): this {
    this.wantsOne = "single";
    return this;
  }
  maybeSingle(): this {
    this.wantsOne = "maybe";
    return this;
  }

  private matches(): Row[] {
    let rows = this.db.table(this.name).filter((row) => this.filters.every((f) => f(row)));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.max !== null) rows = rows.slice(0, this.max);
    return rows;
  }

  private run(): { data: unknown; error: { message: string; code?: string } | null } {
    const missing = this.db.missingColumns[this.name] ?? [];
    if (this.op === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const row of incoming) {
        const bad = missing.find((column) => column in row);
        if (bad) return { data: null, error: { message: `column "${bad}" of relation "${this.name}" does not exist` } };
      }
      if ((this.db.failInserts[this.name] ?? 0) > 0) {
        this.db.failInserts[this.name] -= 1;
        return { data: null, error: { message: "temporary database error" } };
      }
      for (const row of incoming) {
        for (const key of this.db.uniqueKeys[this.name] ?? []) {
          if (key.some((column) => row[column] == null)) continue;
          const clash = this.db.table(this.name).some((saved) => key.every((column) => saved[column] === row[column]));
          if (clash) {
            return {
              data: null,
              error: { message: `duplicate key value violates unique constraint on ${key.join(",")}`, code: "23505" },
            };
          }
        }
      }
      const created = incoming.map((row) => {
        const saved: Row = { id: this.db.nextId(this.name), created_at: new Date().toISOString(), ...row };
        this.db.table(this.name).push(saved);
        return saved;
      });
      return { data: this.wantsOne ? created[0] : created, error: null };
    }
    if (this.op === "update") {
      const rows = this.matches();
      for (const row of rows) Object.assign(row, this.payload);
      return { data: this.wantsOne ? (rows[0] ?? null) : rows, error: null };
    }
    if (this.op === "delete") {
      const rows = this.matches();
      this.db.tables[this.name] = this.db.table(this.name).filter((row) => !rows.includes(row));
      return { data: null, error: null };
    }
    const unknown = this.filtered.find((column) => missing.includes(column));
    if (unknown) {
      return { data: null, error: { message: `column ${this.name}.${unknown} does not exist` } };
    }
    const rows = this.matches();
    if (this.wantsOne === "single") {
      return rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "no rows" } };
    }
    if (this.wantsOne === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }

  then<TResult1 = { data: unknown; error: { message: string; code?: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
