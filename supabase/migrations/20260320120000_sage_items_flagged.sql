-- Private flag for court/reference (visible only via visible_to scoping; not shared with co-parent)
alter table sage_items add column if not exists flagged boolean not null default false;
