'use client';

import { motion } from 'framer-motion';
import {
    LayoutDashboard,
    BarChart2,
    Users,
    Globe,
    BrainCircuit,
    Settings,
    ChevronRight,
    Menu
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

const NAV_ITEMS = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'market', label: 'Market Data', icon: BarChart2 },
    { id: 'social', label: 'Social & VoC', icon: Users },
    { id: 'media', label: 'Media Assets', icon: Globe },
    { id: 'strategy', label: 'Strategy', icon: BrainCircuit },
];

export function DashboardLayout({ children, brandName }: { children: React.ReactNode, brandName: string }) {
    const [activeTab, setActiveTab] = useState('overview');

    return (
        <div className="flex min-h-screen bg-zinc-950 text-zinc-100 font-sans">

            {/* SIDEBAR */}
            <aside className="w-64 border-r border-zinc-900 bg-zinc-950/50 backdrop-blur-xl flex flex-col fixed h-full z-20">
                <div className="p-6 border-b border-zinc-900 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white">
                        B
                    </div>
                    <span className="font-space font-bold text-lg tracking-tight">BrandStrat<span className="text-blue-500">.ai</span></span>
                </div>

                <div className="p-4 flex-1 space-y-1">
                    <div className="px-2 mb-4">
                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Workspace</p>
                        <div className="bg-zinc-900 p-2 rounded-md flex items-center justify-between group cursor-pointer hover:bg-zinc-800 transition-colors">
                            <span className="text-sm font-medium truncate">{brandName || 'Loading...'}</span>
                            <ChevronRight size={14} className="text-zinc-500" />
                        </div>
                    </div>

                    <p className="px-2 text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 mt-6">Navigation</p>
                    {NAV_ITEMS.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all
                            ${isActive
                                        ? 'bg-blue-500/10 text-blue-400'
                                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'}`}
                            >
                                <Icon size={18} />
                                {item.label}
                            </button>
                        )
                    })}
                </div>

                <div className="p-4 border-t border-zinc-900">
                    <button className="flex items-center gap-3 px-3 py-2 w-full text-zinc-500 hover:text-white transition-colors text-sm">
                        <Settings size={18} />
                        System Settings
                    </button>
                </div>
            </aside>

            {/* MAIN CONTENT */}
            <main className="flex-1 ml-64 min-h-screen relative">
                {/* Simple Topbar for mobile responsiveness hook (future) or global search */}
                <header className="h-16 border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10 px-8 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-zinc-500">
                        <span>Projects</span>
                        <ChevronRight size={14} />
                        <span className="text-zinc-200">{brandName}</span>
                        <ChevronRight size={14} />
                        <span className="text-zinc-200 capitalize">{activeTab}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-xs font-semibold text-emerald-500">Live System</span>
                        </div>
                    </div>
                </header>

                <div className="p-8 max-w-7xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
