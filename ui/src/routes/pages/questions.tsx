import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import { useListKeyboardNav } from "@/hooks/use-keyboard";
import { Badge } from "@/components/ui/badge";
import { ListRowSkeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import type { Question } from "@/types/sonde";

export default function QuestionsPage() {
  const program = useActiveProgram();

  const { data: questions, isLoading } = useQuery({
    queryKey: queryKeys.questions.inbox(program),
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await supabase
        .from("research_inbox")
        .select("*")
        .eq("program", program);
      if (error) throw error;
      return data;
    },
    enabled: !!program,
  });

  const items = questions ?? [];
  const handleSelect = useCallback(() => {}, []);
  const { focusedIndex } = useListKeyboardNav(items, handleSelect);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Questions
          </h1>
        </div>
        <div className="rounded-[8px] border border-border bg-surface">
          {Array.from({ length: 6 }).map((_, i) => (
            <ListRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
          Questions
        </h1>
        <span className="text-[12px] text-text-quaternary">
          {questions?.length ?? 0} open
        </span>
      </div>

      <div className="rounded-[8px] border border-border bg-surface">
        {items.map((q, idx) => (
          <div
            key={q.id}
            className={`flex items-start gap-4 border-b border-border-subtle px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-hover ${focusedIndex === idx ? "ring-1 ring-inset ring-accent bg-surface-hover" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-text-quaternary">
                  {q.id}
                </span>
                {q.raised_by && (
                  <span className="text-[11px] text-text-quaternary">
                    from {q.raised_by}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[13px] text-text">{q.question}</p>
              {q.context && (
                <p className="mt-0.5 text-[12px] text-text-tertiary">
                  {q.context}
                </p>
              )}
              {q.tags.length > 0 && (
                <div className="mt-1.5 flex gap-1">
                  {q.tags.map((t) => (
                    <Badge key={t} variant="tag" dot={false}>
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-text-quaternary">
              {formatRelativeTime(q.created_at)}
            </span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="py-10 text-center text-[13px] text-text-quaternary">
            No open questions.
          </div>
        )}
      </div>
    </div>
  );
}
