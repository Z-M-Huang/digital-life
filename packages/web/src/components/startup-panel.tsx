type StartupLog = {
  level: string;
  message: string;
};

export const StartupPanel = ({ logs }: { logs: StartupLog[] }) => (
  <div className="log-list">
    {logs.length === 0 ? (
      <p className="muted">No startup validation logs yet.</p>
    ) : (
      logs.map((log, index) => (
        <article className={`log-entry log-${log.level}`} key={`${log.level}-${index}`}>
          <strong>{log.level.toUpperCase()}</strong>
          <span>{log.message}</span>
        </article>
      ))
    )}
  </div>
);
