import Link from "next/link";
import { notFound } from "next/navigation";
import { apiClient } from "@/lib/api-client";

async function getResearchJob(id: string) {
    try {
        return await apiClient.getResearchJob(id);
    } catch {
        return null;
    }
}

export default async function ResearchJobPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const job = await getResearchJob(id);

    if (!job) {
        notFound();
    }

    const client = job.client;
    const account = client.clientAccounts?.[0];
    const posts = account ? account.clientPosts : [];
    const competitors = job.discoveredCompetitors || [];
    const mentions = client.brandMentions || [];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 pb-20">
            <header className="border-b border-white/10 backdrop-blur-sm sticky top-0 z-10 bg-slate-900/80">
                <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <Link
                            href={`/clients/${client.id}`}
                            className="text-gray-400 hover:text-white text-sm"
                        >
                            ← Back to Client
                        </Link>
                        <h1 className="text-xl font-bold text-white">
                            Research Job: <span className="font-mono text-purple-400">{job.id.slice(0, 8)}</span>
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${job.status === 'COMPLETE' ? 'bg-green-500/20 text-green-400' :
                            job.status === 'FAILED' ? 'bg-red-500/20 text-red-400' :
                                'bg-yellow-500/20 text-yellow-400 animate-pulse'
                            }`}>
                            {job.status}
                        </span>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

                {/* Error Message */}
                {job.errorMessage && (
                    <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-red-200 font-mono text-sm whitespace-pre-wrap">
                        <strong>Error:</strong> {job.errorMessage}
                    </div>
                )}

                {/* Overview Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label="Posts Scraped" value={posts.length} />
                    <StatCard label="Competitors Found" value={competitors.length} />
                    <StatCard label="Brand Mentions" value={mentions.length} />
                    <StatCard label="Media Assets" value={posts.reduce((acc: number, p: any) => acc + (p.mediaAssets?.length || 0), 0)} />
                </div>

                {/* Section: Scraped Posts & AI Analysis */}
                <section>
                    <h2 className="text-2xl font-bold text-white mb-4">📸 Scraped Content & AI Analysis</h2>
                    {posts.length === 0 ? (
                        <div className="text-gray-500 italic">No posts scraped yet.</div>
                    ) : (
                        <div className="grid gap-6">
                            {posts.map((post: any) => (
                                <div key={post.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                                    <div className="p-4 bg-white/5 border-b border-white/10 flex justify-between items-start">
                                        <div>
                                            <a href={post.postUrl} target="_blank" className="text-purple-400 hover:underline text-sm font-mono">
                                                Details
                                            </a>
                                            <p className="text-gray-400 text-xs mt-1">{new Date(post.postedAt).toLocaleDateString()}</p>
                                        </div>
                                        <div className="flex gap-3 text-sm text-gray-300">
                                            <span>❤️ {post.likes}</span>
                                            <span>💬 {post.comments}</span>
                                        </div>
                                    </div>

                                    <div className="grid md:grid-cols-2 gap-0">
                                        {/* Visual / Media */}
                                        <div className="p-4 border-r border-white/10">
                                            <h3 className="text-sm font-bold text-gray-400 uppercase mb-2">Media & Visual Analysis</h3>
                                            {post.mediaAssets?.length > 0 ? (
                                                <div className="space-y-4">
                                                    {post.mediaAssets.map((media: any) => (
                                                        <div key={media.id}>
                                                            <img
                                                                src={`http://localhost:3001/storage/${media.blobStoragePath.split('storage/')[1]}`}
                                                                alt="Post media"
                                                                className="w-full h-64 object-cover rounded-lg mb-2"
                                                            />
                                                            {/* Visual AI Analysis if linked */}
                                                            {post.aiAnalyses?.find((a: any) => a.analysisType === 'VISUAL' && a.mediaAssetId === media.id) && (
                                                                <div className="text-xs text-green-300 bg-green-900/20 p-2 rounded">
                                                                    ✓ Visual Analyzed
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}

                                                    {/* General Visual Analysis (if not linked to specific asset) */}
                                                    {post.aiAnalyses?.filter((a: any) => a.analysisType === 'VISUAL').map((analysis: any) => (
                                                        <div key={analysis.id} className="bg-black/30 p-3 rounded text-sm">
                                                            <p className="text-gray-300"><strong className="text-white">Style:</strong> {analysis.visualStyleNotes}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-gray-500 italic">No media downloaded</p>
                                            )}
                                        </div>

                                        {/* Caption & Text Analysis */}
                                        <div className="p-4">
                                            <h3 className="text-sm font-bold text-gray-400 uppercase mb-2">Caption & Strategy</h3>
                                            <div className="bg-black/20 p-3 rounded mb-4">
                                                <p className="text-gray-300 text-sm whitespace-pre-wrap line-clamp-6 hover:line-clamp-none transition-all cursor-pointer">
                                                    {post.caption}
                                                </p>
                                            </div>

                                            {post.aiAnalyses?.filter((a: any) => a.analysisType === 'CAPTION' || a.analysisType === 'OVERALL').map((analysis: any) => (
                                                <div key={analysis.id} className="mb-3 space-y-2 text-sm">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-xs font-mono text-purple-400 uppercase">{analysis.analysisType} Analysis</span>
                                                        <span className="text-xs text-gray-500">Score: {analysis.confidenceScore}</span>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="bg-white/5 p-2 rounded">
                                                            <span className="block text-xs text-gray-500">Topic</span>
                                                            <span className="text-white">{analysis.topic}</span>
                                                        </div>
                                                        <div className="bg-white/5 p-2 rounded">
                                                            <span className="block text-xs text-gray-500">Pillar</span>
                                                            <span className="text-purple-300">{analysis.contentPillarDetected}</span>
                                                        </div>
                                                        <div className="bg-white/5 p-2 rounded col-span-2">
                                                            <span className="block text-xs text-gray-500">Hook Pattern</span>
                                                            <span className="text-gray-300">{analysis.hookAnalysis}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Section: Competitors */}
                <section>
                    <h2 className="text-2xl font-bold text-white mb-4">🕵️ Discovered Competitors</h2>
                    {competitors.length === 0 ? (
                        <div className="text-gray-500 italic">No competitors discovered.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm text-gray-300">
                                <thead className="bg-white/5 text-gray-400 uppercase text-xs">
                                    <tr>
                                        <th className="p-3">Handle</th>
                                        <th className="p-3">Reason</th>
                                        <th className="p-3">Relevance</th>
                                        <th className="p-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/10">
                                    {competitors.map((comp: any) => (
                                        <tr key={comp.id} className="hover:bg-white/5">
                                            <td className="p-3 font-medium text-white">@{comp.handle}</td>
                                            <td className="p-3 max-w-md truncate">{comp.discoveryReason}</td>
                                            <td className="p-3">{(comp.relevanceScore * 100).toFixed(0)}%</td>
                                            <td className="p-3">{comp.status}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* Section: Brand Mentions */}
                <section>
                    <h2 className="text-2xl font-bold text-white mb-4">🌐 Web Brand Mentions</h2>
                    {mentions.length === 0 ? (
                        <div className="text-gray-500 italic">No brand mentions found.</div>
                    ) : (
                        <div className="space-y-3">
                            {mentions.map((mention: any) => (
                                <div key={mention.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                                    <a href={mention.url} target="_blank" className="text-lg font-semibold text-blue-400 hover:underline block truncate">
                                        {mention.title}
                                    </a>
                                    <p className="text-gray-400 text-sm mt-1 mb-2">{mention.snippet}</p>
                                    <div className="flex gap-2 text-xs text-gray-500 uppercase">
                                        <span>{mention.sourceType}</span>
                                        <span>•</span>
                                        <span>AI Analysis: {mention.aiAnalyses?.length > 0 ? 'Done' : 'Pending'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Raw Data Accordion */}
                <section className="pt-8 border-t border-white/10">
                    <details className="cursor-pointer">
                        <summary className="text-gray-500 hover:text-white mb-4 select-none">Show Raw JSON Data (Debug)</summary>
                        <pre className="bg-black p-4 rounded-xl overflow-x-auto text-xs text-green-500 font-mono">
                            {JSON.stringify(job, null, 2)}
                        </pre>
                    </details>
                </section>

            </main>
        </div>
    );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs uppercase mb-1">{label}</p>
            <p className="text-3xl font-bold text-white">{value ?? "-"}</p>
        </div>
    );
}
