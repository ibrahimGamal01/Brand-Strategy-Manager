import type { ReactNode } from 'react';
// ... imports
import {
    User, Newspaper, ImageIcon, RefreshCw, Trash2, Video, Instagram
} from 'lucide-react';
import { TreeNodeCard, DataList } from './';
import { SocialProfileNode } from './SocialProfileNode';
import { PostsGallery } from '../competitor/PostsGallery';
import { PostsGridWithRanking } from '../PostsGridWithRanking';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface ClientInfoNodeProps {
    jobId?: string;
    client: any;
    socialProfiles: any[];
    clientProfileSnapshots?: any[];
    clientDocuments: any[];
    clientPosts: any[];
    tiktokPosts?: any[]; // New prop
    onRefreshSection?: (section: string) => void;
    actions?: ReactNode;
}

export function ClientInfoNode({
    jobId,
    client,
    socialProfiles,
    clientProfileSnapshots = [],
    clientDocuments,
    clientPosts,
    tiktokPosts = [],
    onRefreshSection,
    actions
}: ClientInfoNodeProps) {
    const { toast } = useToast();

    const instagramProfile = socialProfiles.find((p: any) => p.platform === 'instagram');
    const tiktokProfile = socialProfiles.find((p: any) => p.platform === 'tiktok');

    const latestSnapshotFor = (platform: string) =>
        [...clientProfileSnapshots]
            .filter((s: any) => s.clientProfile?.platform === platform)
            .sort((a: any, b: any) => new Date(b.scrapedAt || 0).getTime() - new Date(a.scrapedAt || 0).getTime())[0];

    const instagramSnapshot = latestSnapshotFor('instagram');
    const tiktokSnapshot = latestSnapshotFor('tiktok');

    const instagramPosts = (instagramSnapshot?.posts?.length ? instagramSnapshot.posts : instagramProfile?.posts) || [];
    const tiktokPostsCombined = (tiktokSnapshot?.posts?.length ? tiktokSnapshot.posts : tiktokProfile?.posts) || [];

    const instagramFollowers = instagramSnapshot?.followerCount ?? instagramProfile?.followers ?? 0;
    const tiktokFollowers = tiktokSnapshot?.followerCount ?? tiktokProfile?.followers ?? 0;

    return (
        <TreeNodeCard
            title={`Client: ${client.name || 'Unknown'}`}
            icon={<User className="h-4 w-4" />}
            count={socialProfiles.length + clientDocuments.length}
            defaultExpanded={true}
            level={1}
            actions={actions}
        >
            {/* Dynamic Social Profiles */}
            {socialProfiles.map((profile: any, index: number) => (
                <SocialProfileNode
                    key={profile.id ?? `${profile.platform}-${profile.handle}-${index}`}
                    jobId={jobId}
                    profile={profile}
                    index={index}
                    onRefreshSection={onRefreshSection}
                />
            ))}

            {/* Level 2: Downloaded Content (by platform) */}
            {(instagramPosts.length || tiktokPostsCombined.length) && (
                <TreeNodeCard
                    title="Downloaded Content"
                    icon={<ImageIcon className="h-4 w-4 text-teal-500" />}
                    level={2}
                    defaultExpanded={true}
                >
                    {instagramPosts.length > 0 && (
                        <div className="mb-6">
                            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                <Instagram className="h-4 w-4 text-pink-500" />
                                Instagram Posts
                            </h4>
                            <PostsGridWithRanking
                                posts={instagramPosts.map((p: any) => ({
                                    id: p.id,
                                    caption: p.caption,
                                    likesCount: p.likes || p.likesCount || 0,
                                    commentsCount: p.comments || p.commentsCount || 0,
                                    sharesCount: p.shares || p.sharesCount || 0,
                                    viewsCount: p.views || p.viewsCount || p.playsCount || 0,
                                    playsCount: p.plays || p.playsCount || 0,
                                    postUrl: p.postUrl || p.url,
                                    url: p.postUrl || p.url,
                                    postedAt: p.postedAt || p.timestamp || new Date().toISOString(),
                                    thumbnailUrl: p.thumbnailUrl,
                                    mediaAssets: p.mediaAssets
                                }))}
                                followerCount={instagramFollowers}
                                platform="instagram"
                            />
                        </div>
                    )}

                    {tiktokPostsCombined.length > 0 && (
                        <div>
                            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                                <Video className="h-4 w-4 text-pink-500" />
                                TikTok Posts
                            </h4>
                            <PostsGridWithRanking
                                posts={tiktokPostsCombined.map((p: any) => ({
                                    id: p.id,
                                    caption: p.caption,
                                    likesCount: p.likes || p.likesCount || 0,
                                    commentsCount: p.comments || p.commentsCount || 0,
                                    sharesCount: p.shares || p.sharesCount || 0,
                                    viewsCount: p.views || p.viewsCount || p.playsCount || 0,
                                    playsCount: p.plays || p.playsCount || 0,
                                    postUrl: p.postUrl || p.url,
                                    url: p.postUrl || p.url,
                                    postedAt: p.postedAt || p.timestamp || new Date().toISOString(),
                                    thumbnailUrl: p.thumbnailUrl,
                                    mediaAssets: p.mediaAssets
                                }))}
                                followerCount={tiktokFollowers}
                                platform="tiktok"
                            />
                        </div>
                    )}
                </TreeNodeCard>
            )}

            {/* Level 2: Client Documents */}
            {clientDocuments.length > 0 && (
                <TreeNodeCard
                    title="Documents"
                    icon={<Newspaper className="h-4 w-4 text-orange-500" />}
                    count={clientDocuments.length}
                    level={2}
                    defaultExpanded={false}
                >
                    <DataList
                        items={clientDocuments.map((doc: any) => ({
                            id: doc.id,
                            title: doc.fileName,
                            subtitle: doc.docType,
                            content: doc.extractedText ? `${doc.extractedText.substring(0, 100)}...` : 'No text extracted',
                        }))}
                        emptyMessage="No documents uploaded"
                    />
                </TreeNodeCard>
            )}

            {/* Level 2: Client Posts (Legacy/Direct/Instagram) */}
            {clientPosts.length > 0 && (
                <TreeNodeCard
                    title="Client Posts"
                    icon={<ImageIcon className="h-4 w-4 text-purple-500" />}
                    count={clientPosts.length}
                    level={2}
                    defaultExpanded={false}
                    actions={
                        socialProfiles[0]?.id ? (
                            <div className="flex items-center gap-1">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                            const response = await fetch(`/api/instagram/scrape/${socialProfiles[0].id}`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ postsLimit: 30 })
                                            });
                                            if (response.ok) {
                                                toast({ title: "Re-scraping started", description: "Refreshing posts..." });
                                                setTimeout(() => onRefreshSection?.('client-posts'), 3000);
                                            }
                                        } catch (error: any) {
                                            toast({ title: "Re-scrape failed", description: error.message, variant: "destructive" });
                                        }
                                    }}
                                    className="h-7 text-xs px-2"
                                >
                                    <RefreshCw className="h-3 w-3" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        const confirmed = confirm(`Delete all ${clientPosts.length} posts? This cannot be undone.`);
                                        if (!confirmed) return;

                                        try {
                                            const response = await fetch(`/api/instagram/profile/${socialProfiles[0].id}`, {
                                                method: 'DELETE'
                                            });
                                            if (response.ok) {
                                                toast({ title: "Section reset", description: "All posts deleted" });
                                                setTimeout(() => onRefreshSection?.('client-posts'), 1000);
                                            } else {
                                                toast({ title: "Delete failed", description: await response.text(), variant: "destructive" });
                                            }
                                        } catch (error: any) {
                                            toast({ title: "Delete failed", description: error.message, variant: "destructive" });
                                        }
                                    }}
                                    className="h-7 text-xs px-2 text-destructive hover:text-destructive"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>
                        ) : undefined
                    }
                >
                    <div className="px-4 py-3">
                        <PostsGallery
                            posts={clientPosts.map((p: any) => ({
                                ...p,
                                postUrl: p.postUrl || p.url,
                                timestamp: p.postedAt || p.timestamp || new Date().toISOString(),
                                isVideo: p.mediaType === 'VIDEO' || p.isVideo || false,
                                likes: p.likes || 0,
                                comments: p.comments || 0,
                                engagement: p.engagementRate || 0,
                                caption: p.caption || '',
                                mediaUrl: p.mediaUrl || p.thumbnailUrl,
                                videoUrl: p.videoUrl,
                                id: p.id
                            }))}
                            title="Recent Posts"
                            platform="instagram"
                        />
                    </div>
                </TreeNodeCard>
            )}
        </TreeNodeCard>
    );
}
