interface IntakeLoadingStepProps {
  isExistingClient: boolean;
  filledCount: number;
  handles: string[];
}

export function IntakeLoadingStep({
  isExistingClient,
  filledCount,
  handles,
}: IntakeLoadingStepProps) {
  return (
    <div className="text-center animate-in fade-in duration-500">
      <div className="relative w-24 h-24 mx-auto mb-8">
        <div className="absolute inset-0 border-4 border-zinc-800 rounded-full" />
        <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="absolute inset-4 bg-zinc-900 rounded-full flex items-center justify-center">
          <span className="text-2xl animate-pulse">📡</span>
        </div>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">
        {isExistingClient ? 'Client Found' : 'Starting Research'}
      </h2>
      <p className="text-zinc-500 font-mono text-sm max-w-xs mx-auto">
        {isExistingClient ? (
          <>
            {'>'} EXISTING_CLIENT_DETECTED
            <br />
            {'>'} LOADING_RESEARCH_DATA...
            <br />
            {'>'} REDIRECTING...
          </>
        ) : (
          <>
            {'>'} SCANNING {filledCount} PLATFORM{filledCount !== 1 ? 'S' : ''}...
            <br />
            {'>'} {handles.join(', ')}
            <br />
            {'>'} ORCHESTRATOR_BOOTSTRAP...
          </>
        )}
      </p>
    </div>
  );
}
