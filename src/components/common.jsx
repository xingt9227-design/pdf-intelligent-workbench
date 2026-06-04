export function IconButton({ children, active, onClick }) {
  return (
    <button className={active ? 'icon-tab active' : 'icon-tab'} type="button" onClick={onClick}>
      {children}
    </button>
  )
}

export function ResultPanel({ title, items }) {
  return (
    <section className="result-panel">
      <h3>{title}</h3>
      <div>
        {items.map((item, index) => (
          <p key={`${item}-${index}`}>{item}</p>
        ))}
      </div>
    </section>
  )
}

export function TaskCenter({ tasks, compact = false }) {
  return (
    <section className={compact ? 'task-center compact-task' : 'task-center'}>
      <h3>任务中心</h3>
      <div className="task-list">
        {tasks.slice(0, compact ? 4 : 6).map((task) => (
          <div className="task-row" key={task.id}>
            <span>
              <strong>{task.name}</strong>
              <small>{task.target}</small>
            </span>
            <em className={`state-${task.state}`}>{task.state}</em>
          </div>
        ))}
      </div>
    </section>
  )
}
