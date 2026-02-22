'use client';

export type Phase = 'intelligence' | 'strategy';

interface PhaseNavigationProps {
    activePhase: Phase;
    onPhaseChange: (phase: Phase) => void;
    strategyStatus?: {
        generated: boolean;
        sectionsComplete: number;
        totalSections: number;
    };
}

export default function PhaseNavigation({
    activePhase,
    onPhaseChange,
    strategyStatus
}: PhaseNavigationProps) {

    const getStrategyLabel = () => {
        if (!strategyStatus) return 'Strategy Documents';
        if (strategyStatus.generated) {
            return `Strategy Documents (${strategyStatus.sectionsComplete}/${strategyStatus.totalSections})`;
        }
        return 'Strategy Documents';
    };

    return (
        <div className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <nav className="flex space-x-8" aria-label="Tabs">
                    {/* Intelligence Gathering Tab */}
                    <button
                        onClick={() => onPhaseChange('intelligence')}
                        className={`
              py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${activePhase === 'intelligence'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }
            `}
                    >
                        Intelligence Gathering
                    </button>

                    {/* Strategy Documents Tab */}
                    <button
                        onClick={() => onPhaseChange('strategy')}
                        className={`
              py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2
              ${activePhase === 'strategy'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }
            `}
                    >
                        {getStrategyLabel()}
                        {strategyStatus?.generated && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                ✓ Generated
                            </span>
                        )}
                    </button>
                </nav>
            </div>
        </div>
    );
}
