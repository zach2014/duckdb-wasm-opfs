import type { CSSProperties, ReactNode } from 'react';
import { classNames } from '../lib/format';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="logo-mark"
    >
      <circle cx="16" cy="16" r="13.2" stroke="currentColor" strokeOpacity="0.28" />
      <circle cx="16" cy="16" r="8.2" stroke="currentColor" strokeOpacity="0.52" />
      <path
        d="M16 3.2V16L27.4 22.4"
        stroke="currentColor"
        strokeOpacity="0.85"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.6" fill="currentColor" />
      <circle cx="16" cy="3.2" r="1.7" fill="#9fd0a4" />
    </svg>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  eyebrow,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
  flush,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  return (
    <section className={classNames('card', className)}>
      {(title || eyebrow || action) && (
        <header className="card-head">
          <div className="card-heading">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action && <div className="card-action">{action}</div>}
        </header>
      )}
      <div className={classNames('card-body', flush && 'card-body--flush', bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

export function KpiCard({
  index,
  label,
  value,
  suffix,
  hint,
  tone = 'gold',
  footer,
  delay = 0,
}: {
  index: string;
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  hint: ReactNode;
  tone?: 'gold' | 'green' | 'blue' | 'coral';
  footer?: ReactNode;
  delay?: number;
}) {
  return (
    <article
      className={classNames('kpi', `kpi--${tone}`)}
      style={{ '--delay': `${delay}ms` } as CSSProperties}
    >
      <div className="kpi-top">
        <span className="kpi-index">{index}</span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">
        {value}
        {suffix && <span className="kpi-suffix">{suffix}</span>}
      </div>
      <p className="kpi-hint">{hint}</p>
      {footer && <div className="kpi-footer">{footer}</div>}
    </article>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  dot,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'green' | 'blue' | 'coral' | 'violet';
  dot?: boolean;
}) {
  return (
    <span className={classNames('badge', `badge--${tone}`)}>
      {dot && <i className="badge-dot" />}
      {children}
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="2.4"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <p className="empty-title">{title}</p>
      {body && <p className="empty-body">{body}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function MeterRow({
  label,
  value,
  ratio,
  tone = 'gold',
  caption,
}: {
  label: ReactNode;
  value: ReactNode;
  ratio: number;
  tone?: 'gold' | 'green' | 'coral' | 'blue';
  caption?: ReactNode;
}) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-value">{value}</span>
      </div>
      <div className="meter-track">
        <span
          className={classNames('meter-fill', `meter-fill--${tone}`)}
          style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
        />
      </div>
      {caption && <p className="meter-caption">{caption}</p>}
    </div>
  );
}
