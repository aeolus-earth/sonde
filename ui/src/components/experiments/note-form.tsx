import { useState, memo } from "react";
import { Send } from "lucide-react";
import { useAddNote } from "@/hooks/use-mutations";
import { useAuthStore } from "@/stores/auth";

interface NoteFormProps {
  experimentId: string;
}

export const NoteForm = memo(function NoteForm({ experimentId }: NoteFormProps) {
  const [content, setContent] = useState("");
  const user = useAuthStore((s) => s.user);
  const mutation = useAddNote(experimentId);

  const handleSubmit = () => {
    if (!content.trim() || !user) return;
    const source = `human/${user.email?.split("@")[0] ?? "unknown"}`;
    mutation.mutate(
      { content: content.trim(), source },
      { onSuccess: () => setContent("") }
    );
  };

  return (
    <div className="flex gap-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add a note…"
        rows={2}
        className="flex-1 resize-none rounded-[5.5px] border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-quaternary focus:border-accent/50 focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.metaKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <button
        onClick={handleSubmit}
        disabled={!content.trim() || mutation.isPending}
        className="self-end rounded-[5.5px] bg-accent p-2 text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
        title="Submit (⌘+Enter)"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
