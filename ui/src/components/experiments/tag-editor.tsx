import { useState, memo, useCallback } from "react";
import { X, Plus } from "lucide-react";
import { TagChip } from "@/components/ui/tag-chip";
import { useAddTag, useRemoveTag } from "@/hooks/use-mutations";

interface TagEditorProps {
  experimentId: string;
  tags: string[];
}

export const TagEditor = memo(function TagEditor({
  experimentId,
  tags,
}: TagEditorProps) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const addMutation = useAddTag(experimentId);
  const removeMutation = useRemoveTag(experimentId);

  const handleAdd = useCallback(() => {
    const tag = input.trim().toLowerCase();
    if (!tag || tags.includes(tag)) {
      setInput("");
      setAdding(false);
      return;
    }
    addMutation.mutate(
      { tag, currentTags: tags },
      {
        onSuccess: () => {
          setInput("");
          setAdding(false);
        },
      }
    );
  }, [input, tags, addMutation]);

  const handleRemove = useCallback(
    (tag: string) => removeMutation.mutate({ tag, currentTags: tags }),
    [tags, removeMutation]
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <TagChip key={t} tag={t}>
          <button
            type="button"
            onClick={() => handleRemove(t)}
            className="shrink-0 rounded-sm text-current/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-current"
            aria-label={`Remove tag ${t}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </TagChip>
      ))}
      {adding ? (
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") {
              setAdding(false);
              setInput("");
            }
          }}
          onBlur={handleAdd}
          autoFocus
          placeholder="tag name"
          className="h-5 w-20 rounded-[3px] border border-border bg-bg px-1 text-[10px] text-text focus:outline-none"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-[3px] p-0.5 text-text-quaternary transition-colors hover:bg-surface-hover hover:text-text-tertiary"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
});
