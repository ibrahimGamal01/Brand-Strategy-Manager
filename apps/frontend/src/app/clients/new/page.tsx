'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Rocket, Search, Globe } from 'lucide-react';
import Link from 'next/link';

export default function NewClientPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1); // 1 = Input, 2 = Processing
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        handle: '',
        platform: 'instagram',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setStep(2); // Show processing UI

        try {
            const response = await fetch('http://localhost:3001/api/clients', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
            });

            const data = await response.json();

            if (!response.ok) {
                setStep(1); // Revert
                throw new Error(data.error || 'Failed to create client');
            }

            // Artificial delay for effect if fast
            setTimeout(() => {
                router.push(`/research/${data.researchJob.id}`);
            }, 1500);

        } catch (err: any) {
            setError(err.message);
            setLoading(false);
            setStep(1);
        }
    };

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">

            {/* Header */}
            <header className="h-16 px-6 border-b border-zinc-900 flex items-center">
                <Link href="/" className="text-zinc-500 hover:text-white flex items-center gap-2 text-sm font-medium transition-colors">
                    <ChevronLeft size={16} />
                    Back to Mission Control
                </Link>
            </header>

            <main className="flex-1 flex flex-col items-center justify-center p-6">

                {step === 1 && (
                    <div className="w-full max-w-md animate-in fade-in zoom-in duration-300">
                        <div className="text-center mb-10">
                            <div className="w-12 h-12 bg-blue-600/10 text-blue-500 rounded-xl flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                                <Rocket size={24} />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Initialize Interface</h1>
                            <p className="text-zinc-500">Configure target metrics for intelligence gathering.</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Target Identity (Brand Name)</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-medium"
                                        placeholder="e.g. Acme Corp"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Social Vector (Handle)</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-zinc-500">
                                            @
                                        </div>
                                        <input
                                            type="text"
                                            required
                                            value={formData.handle}
                                            onChange={(e) => setFormData({ ...formData, handle: e.target.value })}
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all font-mono"
                                            placeholder="username"
                                        />
                                        <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                                            <Globe size={16} className="text-zinc-600" />
                                        </div>
                                    </div>
                                    <p className="text-xs text-zinc-600 mt-2 ml-1">Looking up Instagram endpoint.</p>
                                </div>
                            </div>

                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                                    Error: {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-white text-zinc-950 hover:bg-zinc-200 py-3.5 px-6 rounded-lg font-bold transition-all transform active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                            >
                                <Search size={18} />
                                Start Intelligence Job
                            </button>
                        </form>
                    </div>
                )}

                {step === 2 && (
                    <div className="text-center animate-in fade-in duration-500">
                        <div className="relative w-24 h-24 mx-auto mb-8">
                            <div className="absolute inset-0 border-4 border-zinc-800 rounded-full" />
                            <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <div className="absolute inset-4 bg-zinc-900 rounded-full flex items-center justify-center">
                                <span className="text-2xl animate-pulse">📡</span>
                            </div>
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Establishing Uplink</h2>
                        <p className="text-zinc-500 font-mono text-sm max-w-xs mx-auto">
                            {'>'} ALLOCATING_RESOURCES...<br />
                            {'>'} TARGET: {formData.handle}<br />
                            {'>'} SECURE_CONNECTION_ESTABLISHED
                        </p>
                    </div>
                )}

            </main>
        </div>
    );
}
