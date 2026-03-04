 "use client";

 import { useMemo, useState } from "react";

 export type VowStatsExtended = {
   messages_sent: number;
   messages_softened: number;
   calm_streak_days: number;
   vow_alignment_pct: number | null;
 };

 export type SimpleVow = {
   id: string;
   content: string;
   is_pinned: boolean;
 };

 function pickReflection(stats: VowStatsExtended | null, pinned: SimpleVow[]): string {
   if (!stats) {
     return "This is your space. When you feel ready, write a vow that feels true for you.";
   }

   if (stats.calm_streak_days >= 7) {
     if (stats.calm_streak_days >= 30) {
       return `Your calm streak is ${stats.calm_streak_days} days. What has helped you protect your peace this long?`;
     }
     return `Your calm streak is ${stats.calm_streak_days} days. What has helped you stay grounded this week?`;
   }

   if ((stats.messages_softened ?? 0) > 0) {
     const softened = stats.messages_softened;
     if (softened === 1) {
       return "You softened a hard message this month. That small pause protected your child more than they will ever know.";
     }
     return `You softened ${softened} hard messages this month. Each one protected your children from adult conflict.`;
   }

   if (pinned.length > 0) {
     const first = pinned[0];
     return `Your anchor right now is: “${first.content}”. What would it look like to live this vow in your next conversation?`;
   }

   return "When conflict rises, even one clear sentence can anchor you. What words would you like to return to on the hard days?";
 }

 interface SageReflectionProps {
   stats: VowStatsExtended | null;
   pinned: SimpleVow[];
 }

 export function SageReflection({ stats, pinned }: SageReflectionProps) {
   const [version, setVersion] = useState(0);

   const text = useMemo(() => pickReflection(stats, pinned), [stats, pinned, version]);

   return (
     <section className="space-y-2">
       <div>
         <h2 className="font-heading text-sm font-semibold text-[#3D3D3D]">Sage Reflection</h2>
         <p className="text-[11px] text-foreground-secondary mt-0.5">
           A quiet prompt, just for you.
         </p>
       </div>
       <div className="rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-3 md:px-4 md:py-4 flex items-start gap-3">
         <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-[#E8EDE3] text-[#5B7A52] flex items-center justify-center text-[13px]">
           ?
         </div>
         <div className="min-w-0 flex-1">
           <p className="text-sm text-[#3D3D3D] whitespace-pre-wrap">{text}</p>
           <button
             type="button"
             className="mt-2 text-[11px] text-[#5B7A52] hover:underline underline-offset-2"
             onClick={() => setVersion((v) => v + 1)}
           >
             New prompt
           </button>
         </div>
       </div>
     </section>
   );
 }

