import type { PropsWithChildren, ReactNode } from 'react';

type SectionCardProps = PropsWithChildren<{
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
}>;

export const SectionCard = ({ actions, children, eyebrow, title }: SectionCardProps) => (
  <section className="panel">
    <header className="panel-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {actions ? <div>{actions}</div> : null}
    </header>
    <div className="panel-body">{children}</div>
  </section>
);
