import { notFound } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { CompetitorList } from "@/components/competitors/CompetitorList";
import { NewResearchButton } from "@/components/research/NewResearchButton";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, Heart, MessageCircle } from "lucide-react";

async function getClient(id: string) {
    try {
        const clients = await apiClient.getClients();
        return clients.find((c: any) => c.id === id);
    } catch {
        return null;
    }
}

async function getAnalytics(id: string) {
    try {
        return await apiClient.getClientAnalytics(id);
    } catch {
        return null;
    }
}

async function getCompetitors(id: string) {
    try {
        return await apiClient.getCompetitors(id);
    } catch {
        return { discovered: [], confirmed: [] };
    }
}

export default async function ClientPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const [client, analytics, competitors] = await Promise.all([
        getClient(id),
        getAnalytics(id),
        getCompetitors(id),
    ]);

    if (!client) {
        notFound();
    }

    const account = client.clientAccounts?.[0];
    const latestJob = client.researchJobs?.[0];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
            <header className="border-b border-white/10 backdrop-blur-sm sticky top-0 z-10 bg-slate-900/50">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <Link
                        href="/"
                        className="text-gray-400 hover:text-white text-sm inline-flex items-center gap-2 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
                    </Link>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
                {/* Client Header */}
                <Card className="border-white/10 bg-white/5">
                    <CardContent className="p-8">
                        <div className="flex items-start justify-between">
                            <div>
                                <h1 className="text-3xl font-bold text-white mb-2">
                                    {client.name}
                                </h1>
                                {account && (
                                    <div className="flex items-center gap-4 text-gray-400">
                                        <a
                                            href={account.profileUrl}
                                            target="_blank"
                                            className="hover:text-purple-400 flex items-center gap-1 transition-colors"
                                        >
                                            @{account.handle} <ExternalLink className="w-3 h-3" />
                                        </a>
                                        <span>•</span>
                                        <span>
                                            {account.followerCount?.toLocaleString()} followers
                                        </span>
                                        <span>•</span>
                                        <span>
                                            {account.followingCount?.toLocaleString()} following
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div className="text-right">
                                <Badge
                                    variant={
                                        latestJob?.status === "COMPLETE" ? "success" :
                                            latestJob?.status === "FAILED" ? "destructive" :
                                                "warning"
                                    }
                                >
                                    {latestJob?.status || "No research"}
                                </Badge>
                            </div>
                        </div>
                        {account?.bio && (
                            <p className="mt-4 text-gray-300 max-w-2xl">{account.bio}</p>
                        )}
                    </CardContent>
                </Card>

                {/* Stats Grid */}
                {analytics && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard label="Total Posts" value={analytics.totalPosts} />
                        <StatCard
                            label="Avg Likes"
                            value={analytics.avgLikes?.toLocaleString()}
                        />
                        <StatCard
                            label="Avg Comments"
                            value={analytics.avgComments?.toLocaleString()}
                        />
                        <StatCard
                            label="Engagement"
                            value={`${Number(analytics.avgEngagement).toFixed(2)}%`}
                        />
                    </div>
                )}

                {/* Content Pillars */}
                {analytics?.pillarDistribution && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Content Pillars</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-wrap gap-3">
                                {Object.entries(analytics.pillarDistribution).map(
                                    ([pillar, count]) => (
                                        <Badge
                                            key={pillar}
                                            variant="secondary"
                                            className="text-base py-1 px-3"
                                        >
                                            {pillar}
                                            <span className="ml-2 opacity-50"> {count as number}</span>
                                        </Badge>
                                    )
                                )}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Research History */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Research History</CardTitle>
                        <NewResearchButton clientId={client.id} />
                    </CardHeader>
                    <CardContent>
                        {client.researchJobs?.length > 0 ? (
                            <div className="space-y-3">
                                {client.researchJobs.map((job: any) => (
                                    <div
                                        key={job.id}
                                        className="bg-white/5 p-4 rounded-lg flex justify-between items-center group border border-white/5 hover:border-purple-500/30 transition-colors"
                                    >
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <span
                                                    className={`w-2 h-2 rounded-full ${job.status === "COMPLETE"
                                                        ? "bg-green-500"
                                                        : job.status === "FAILED"
                                                            ? "bg-red-500"
                                                            : "bg-yellow-500 animate-pulse"
                                                        }`}
                                                />
                                                <Link
                                                    href={`/research-jobs/${job.id}`}
                                                    className="text-white font-medium hover:text-purple-400 transition-colors"
                                                >
                                                    Research Job {job.id.slice(0, 8)}
                                                </Link>
                                            </div>
                                            <p className="text-gray-400 text-xs ml-5 mt-1">
                                                Started:{" "}
                                                {(job.startedAt || job.createdAt)
                                                    ? new Date(
                                                        job.startedAt || job.createdAt
                                                    ).toLocaleDateString()
                                                    : "Pending"}
                                                {job.errorMessage && (
                                                    <span className="text-red-400 ml-2">
                                                        • Error: {job.errorMessage}
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                        <Link
                                            href={`/research-jobs/${job.id}`}
                                            className="px-3 py-1 bg-white/10 text-gray-300 text-sm rounded hover:bg-white/20 transition-colors"
                                        >
                                            View Details →
                                        </Link>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-400">No research jobs found.</p>
                        )}
                    </CardContent>
                </Card>

                {/* Competitors */}
                <Card>
                    <CardHeader>
                        <CardTitle>
                            Discovered Competitors ({competitors.discovered?.length || 0})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <CompetitorList
                            initialCompetitors={competitors.discovered || []}
                            clientId={client.id}
                        />
                    </CardContent>
                </Card>

                {/* Top Posts */}
                {analytics?.topPosts?.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Top Posts</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {analytics.topPosts.map((post: any, i: number) => (
                                    <div
                                        key={post.id}
                                        className="bg-white/5 rounded-lg p-4 flex items-start gap-4 border border-white/5 hover:border-white/10 transition-colors"
                                    >
                                        <span className="text-2xl text-purple-400 font-bold opacity-50">#{i + 1}</span>
                                        <div className="flex-1">
                                            <p className="text-gray-300 line-clamp-2">
                                                {post.caption}
                                            </p>
                                            <div className="flex gap-4 mt-2 text-sm text-gray-400">
                                                <span className="flex items-center gap-1"><Heart className="w-4 h-4 text-red-400/70" /> {post.likes?.toLocaleString()}</span>
                                                <span className="flex items-center gap-1"><MessageCircle className="w-4 h-4 text-blue-400/70" /> {post.comments?.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </main>
        </div>
    );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
    return (
        <Card>
            <CardContent className="p-4 flex flex-col justify-center h-full">
                <p className="text-gray-400 text-sm">{label}</p>
                <p className="text-2xl font-bold text-white">{value ?? "-"}</p>
            </CardContent>
        </Card>
    );
}
