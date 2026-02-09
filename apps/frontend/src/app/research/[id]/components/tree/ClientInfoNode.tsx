// ... imports
import {
    User, Newspaper, ImageIcon, RefreshCw, Trash2, Video
} from 'lucide-react';
import { TreeNodeCard, DataList } from './';
import { SocialProfileNode } from './SocialProfileNode';
import { PostsGallery } from '../competitor/PostsGallery';
import { PostsGridWithRanking } from '../PostsGridWithRanking';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface ClientInfoNodeProps {
    client: any;
    socialProfiles: any[];
    clientDocuments: any[];
    clientPosts: any[];
    tiktokPosts?: any[]; // New prop
    onRefreshSection?: (section: string) => void;
}

export function ClientInfoNode({
    client,
    socialProfiles,
    clientDocuments,
    clientPosts,
    tiktokPosts = [],
    onRefreshSection
}: ClientInfoNodeProps) {
    const { toast } = useToast();

    console.log('[ClientInfoNode] socialProfiles:', socialProfiles);
    console.log('[ClientInfoNode] tiktokPosts:', tiktokPosts.length);

    return (
        <TreeNodeCard
            title={`Client: ${client.name || 'Unknown'}`}
            icon={<User className="h-4 w-4" />}
            count={socialProfiles.length + clientDocuments.length}
            defaultExpanded={true}
            level={1}
        >
            {/* Dynamic Social Profiles */}
            {socialProfiles.map((profile: any, index: number) => (
                <SocialProfileNode
                    key={`${profile.platform}-${index}`}
                    profile={profile}
                    index={index}
                    onRefreshSection={onRefreshSection} // Pass the prop
                />
            ))}

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
                                            const response = await fetch(`http://localhost:3001/api/instagram/scrape/${socialProfiles[0].id}`, {
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
                                            const response = await fetch(`http://localhost:3001/api/instagram/profile/${socialProfiles[0].id}`, {
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
