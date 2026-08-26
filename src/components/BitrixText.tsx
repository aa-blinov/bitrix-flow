import { parseBitrixMarkup } from '@/lib/bitrix-markup';
import { cn } from '@/lib/utils';

export default function BitrixText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {parseBitrixMarkup(text).map((part, index) =>
        part.href ? (
          <a key={index} href={part.href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
