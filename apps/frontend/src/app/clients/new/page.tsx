'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Rocket, Search, Instagram, Play, Youtube, Twitter } from 'lucide-react';
import Link from 'next/link';

const PLATFORMS = [
    { id: 'instagram', name: 'Instagram', icon: Instagram, placeholder: 'username', color: 'pink' },
    { id: 'tiktok', name: 'TikTok', icon: Play, placeholder: 'username', color: 'cyan' },
    { id: 'youtube', name: 'YouTube', icon: Youtube, placeholder: 'channel', color: 'red' },
    { id: 'twitter', name: 'X/Twitter', icon: Twitter, placeholder: 'username', color: 'blue' },
];

export default function NewClientPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1);
    const [error, setError] = useState('');
    const [isExistingClient, setIsExistingClient] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        niche: '',
        handles: {
            instagram: '',
            tiktok: '',
            youtube: '',
            twitter: '',
        } as Record<string, string>,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        // Validate at least one handle is provided
        const filledHandles = Object.entries(formData.handles).filter(([_, v]) => v.trim());
        if (filledHandles.length === 0) {
            setError('Please provide at least one social media handle');
            setLoading(false);
            return;
        }

        setStep(2);

        try {
            const response = await fetch('http://localhost:3001/api/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.name,
                    niche: formData.niche,
                    handles: formData.handles,
                    handle: filledHandles[0][1],
                    platform: filledHandles[0][0],
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                setStep(1);
                throw new Error(data.error || 'Failed to create client');
            }

            // Check if we found an existing client/job
            const isExisting = data.isExisting === true;
            setIsExistingClient(isExisting);

            // Redirect to the research job (same ID whether new or existing)
            setTimeout(() => {
                router.push(`/research/${data.researchJob.id}`);
            }, isExisting ? 800 : 1500); // Faster redirect for existing

        } catch (err: any) {
            setError(err.message);
            setLoading(false);
            setStep(1);
        }
    };

    const updateHandle = (platform: string, value: string) => {
        setFormData({
            ...formData,
            handles: { ...formData.handles, [platform]: value }
        });
    };

    const filledCount = Object.values(formData.handles).filter(v => v.trim()).length;

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
                    <div className="w-full max-w-lg animate-in fade-in zoom-in duration-300">
                        <div className="text-center mb-10">
                            <div className="w-12 h-12 bg-blue-600/10 text-blue-500 rounded-xl flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                                <Rocket size={24} />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Initialize Research</h1>
                            <p className="text-zinc-500">Enter your social media handles for intelligence gathering.</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">

                            {/* Brand Name */}
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                    Brand Name
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-medium"
                                    placeholder="e.g. Acme Corp"
                                />
                            </div>

                            {/* Niche */}
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                    Niche / Industry
                                </label>
                                <input
                                    type="text"
                                    value={formData.niche}
                                    onChange={(e) => setFormData({ ...formData, niche: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500/50 focus:border-zinc-600 transition-all"
                                    placeholder="e.g. Islamic Finance, Fitness, SaaS"
                                />
                            </div>

                            {/* Social Handles */}
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
                                    Social Media Handles
                                    <span className="text-zinc-600 font-normal ml-2">
                                        ({filledCount} added)
                                    </span>
                                </label>
                                <div className="grid gap-3">
                                    {PLATFORMS.map((platform) => {
                                        const Icon = platform.icon;
                                        const hasValue = formData.handles[platform.id]?.trim();
                                        return (
                                            <div key={platform.id} className="relative">
                                                <div className={`absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none ${hasValue ? 'text-white' : 'text-zinc-600'
                                                    }`}>
                                                    <Icon size={18} />
                                                </div>
                                                <input
                                                    type="text"
                                                    value={formData.handles[platform.id]}
                                                    onChange={(e) => updateHandle(platform.id, e.target.value)}
                                                    className={`w-full bg-zinc-900 border rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none transition-all font-mono text-sm ${hasValue
                                                        ? 'border-zinc-600 ring-1 ring-zinc-600/50'
                                                        : 'border-zinc-800 focus:ring-2 focus:ring-zinc-500/50'
                                                        }`}
                                                    placeholder={`@${platform.placeholder} (${platform.name})`}
                                                />
                                                {hasValue && (
                                                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                                                        <span className="text-xs text-green-500">✓</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-zinc-600 mt-2 ml-1">
                                    Add at least one handle. We'll search for images and videos from each platform.
                                </p>
                            </div>

                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                                    Error: {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || filledCount === 0}
                                className="w-full bg-white text-zinc-950 hover:bg-zinc-200 py-3.5 px-6 rounded-lg font-bold transition-all transform active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                            >
                                <Search size={18} />
                                Start Research ({filledCount} platform{filledCount !== 1 ? 's' : ''})
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
                        <h2 className="text-xl font-bold text-white mb-2">
                            {isExistingClient ? 'Client Found' : 'Starting Research'}
                        </h2>
                        <p className="text-zinc-500 font-mono text-sm max-w-xs mx-auto">
                            {isExistingClient ? (
                                <>
                                    {'>'} EXISTING_CLIENT_DETECTED<br />
                                    {'>'} LOADING_RESEARCH_DATA...<br />
                                    {'>'} REDIRECTING...
                                </>
                            ) : (
                                <>
                                    {'>'} SCANNING {filledCount} PLATFORM{filledCount !== 1 ? 'S' : ''}...<br />
                                    {'>'} {Object.entries(formData.handles)
                                        .filter(([_, v]) => v.trim())
                                        .map(([p, h]) => `@${h}`)
                                        .join(', ')}<br />
                                    {'>'} GATHERING_INTEL...
                                </>
                            )}
                        </p>
                    </div>
                )}

            </main>
        </div>
    );
}
