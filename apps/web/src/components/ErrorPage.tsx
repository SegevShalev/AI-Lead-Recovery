interface ErrorPageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorPage({ message, onRetry }: ErrorPageProps) {
  return (
    <div className="error-page">
      <div className="error-page__card">
        <div className="error-page__badge">!</div>
        <h1 className="error-page__title">Something&apos;s not working</h1>
        <p className="error-page__message">{message}</p>
        {onRetry ? (
          <button className="error-page__retry" onClick={onRetry} type="button">
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
