import { AlertTriangle, Check, Loader2, Lock } from 'lucide-react';
import { useDatabase } from '../db/DatabaseContext';
import { Logo } from './ui';

export function BootScreen() {
  const { steps, status, error, catalog } = useDatabase();
  const done = steps.filter((step) => step.state === 'done').length;
  const progress = status === 'ready' ? 1 : done / steps.length;

  return (
    <div className="boot">
      <div className="boot-inner">
        <div className="boot-intro">
          <div className="boot-brand">
            <span className="boot-logo">
              <Logo size={38} />
            </span>
            <div>
              <p className="wordmark">Atlas Workbench</p>
              <p className="wordmark-sub">本地数据项目工作台</p>
            </div>
          </div>

          <p className="eyebrow boot-eyebrow">LOCAL-FIRST DATA CATALOG</p>
          <h1 className="boot-title">
            把散落的数据文件，
            <br />
            变成一座<em>本地仓库</em>。
          </h1>
          <p className="boot-lede">
            数据根目录下的每个子目录是一个项目，每个文件或工作表是一张独立的数据表。
            选择项目、选择数据源，再用 DuckDB 在本机加载、查询与导出。
          </p>

          <div className="boot-chips">
            <span>
              <i className="chip-dot chip-dot--gold" />
              DuckDB-Wasm
            </span>
            <span>
              <i className="chip-dot chip-dot--green" />
              OPFS 持久化
            </span>
            <span>
              <Lock size={11} />
              零上传
            </span>
          </div>
        </div>

        <div className="boot-panel">
          <div className="boot-panel-head">
            <div className="boot-panel-status">
              <span
                className={`status-light ${
                  status === 'error' ? 'status-light--error' : ''
                }`}
              />
              <span className="mono">workbench.boot()</span>
            </div>
            <span className="mono boot-count">
              {String(Math.min(done, steps.length)).padStart(2, '0')} /{' '}
              {String(steps.length).padStart(2, '0')}
            </span>
          </div>

          <ol className="boot-steps">
            {steps.map((step) => (
              <li
                key={step.id}
                className={`boot-step boot-step--${step.state}`}
              >
                <span className="boot-step-icon">
                  {step.state === 'done' && <Check size={12} strokeWidth={2.6} />}
                  {step.state === 'active' && <Loader2 size={12} className="spin" />}
                  {step.state === 'error' && <AlertTriangle size={12} />}
                  {step.state === 'pending' && <span className="step-dot" />}
                </span>
                <div className="boot-step-text">
                  <span className="boot-step-label">{step.label}</span>
                  <span className="boot-step-detail">
                    {step.detail ?? step.hint}
                  </span>
                </div>
                <span className="mono boot-step-state">{step.state}</span>
              </li>
            ))}
          </ol>

          <div className="boot-progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>

          {status === 'error' ? (
            <div className="boot-error">
              <p>引擎启动失败</p>
              <code>{error}</code>
              <button className="btn btn--primary" onClick={() => location.reload()}>
                重新加载
              </button>
            </div>
          ) : (
            <p className="boot-foot">
              <Lock size={11} />
              {catalog
                ? `${catalog.projectCount} 个项目 · ${catalog.sourceCount} 个数据源已索引`
                : '目录只被索引，不会在任何地方合并。'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
