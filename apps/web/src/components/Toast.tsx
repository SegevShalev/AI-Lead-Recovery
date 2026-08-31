interface ToastProps {
  message: string;
}

export function Toast({ message }: ToastProps) {
  return (
    <div className="toast" role="status">
      <span className="toast__dot" />
      <span className="toast__text">{message}</span>
    </div>
  );
}
