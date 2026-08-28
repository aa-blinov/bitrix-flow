import { Fragment, type ReactNode } from 'react';
import { parseBitrixNodes, type BitrixNode } from '@/lib/bitrix-markup';
import { cn } from '@/lib/utils';

function render(nodes: BitrixNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    const children = render('children' in node ? node.children : []);
    if (node.type === 'text') return <Fragment key={index}>{node.text}</Fragment>;
    if (node.type === 'link')
      return (
        <a
          key={index}
          href={node.href}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {children}
        </a>
      );
    if (node.type === 'image')
      return (
        <img
          key={index}
          src={node.src}
          alt=""
          className="my-1 inline-block max-h-80 max-w-full rounded"
        />
      );
    if (node.type === 'code')
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {node.text}
        </code>
      );
    if (node.type === 'quote')
      return (
        <blockquote
          key={index}
          className="my-2 border-l-2 border-muted-foreground/40 pl-3 text-muted-foreground"
        >
          {children}
        </blockquote>
      );
    if (node.type === 'list') {
      const List = node.ordered ? 'ol' : 'ul';
      return (
        <List key={index} className="my-2 list-inside list-disc pl-2 marker:text-muted-foreground">
          {node.items.map((item, itemIndex) => (
            <li key={itemIndex}>{render(item)}</li>
          ))}
        </List>
      );
    }
    const Tag =
      node.format === 'b' ? 'strong' : node.format === 'i' ? 'em' : node.format === 'u' ? 'u' : 's';
    return <Tag key={index}>{children}</Tag>;
  });
}

export default function BitrixText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {render(parseBitrixNodes(text))}
    </span>
  );
}
