'use client';

import { useState } from 'react';
import { ExternalLink, Download, Edit2, Trash2, Loader2, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyForBatButton } from '../CopyForBatButton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface Competitor {
    id: string;
    handle: string;
    platform: string;
    profileUrl?: string;
    relevanceScore?: number;
    status: 'SUGGESTED' | 'SCRAPING' | 'SCRAPED' | 'FAILED' | 'CONFIRMED' | 'REJECTED';
    selectionState?: 'FILTERED_OUT' | 'SHORTLISTED' | 'TOP_PICK' | 'APPROVED' | 'REJECTED';
    availabilityStatus?: 'UNVERIFIED' | 'VERIFIED' | 'PROFILE_UNAVAILABLE' | 'INVALID_HANDLE' | 'RATE_LIMITED' | 'CONNECTOR_ERROR';
    selectionReason?: string;
    discoveryReason?: string;
    postsScraped?: number;
    scrapedAt?: string;
}

interface CompetitorRowProps {
    competitor: Competitor;
    onEdit?: (id: string, updates: any) => void;
    onDelete?: (id: string) => void;
    onScrape?: (id: string) => void;
    isScraping?: boolean;
    className?: string;
}

/**
 * CompetitorRow - Individual competitor with inline edit, delete, and scrape
 * Features:
 * - Inline editing of handle, platform, relevanceScore
 * - Delete with confirmation dialog
 * - Scrape action with progress
 * - Status indicators
 */
export function CompetitorRow({
    competitor,
    onEdit,
    onDelete,
    onScrape,
    isScraping = false,
    className = ''
}: CompetitorRowProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({
        handle: competitor.handle,
        platform: competitor.platform,
        relevanceScore: competitor.relevanceScore || 0
    });

    const handleSave = () => {
        if (!onEdit) return;

        onEdit(competitor.id, {
            handle: editData.handle,
            platform: editData.platform,
            relevanceScore: editData.relevanceScore
        });

        setIsEditing(false);
        toast.success(`Updated @${editData.handle}`);
    };

    const handleCancel = () => {
        setEditData({
            handle: competitor.handle,
            platform: competitor.platform,
            relevanceScore: competitor.relevanceScore || 0
        });
        setIsEditing(false);
    };

    const handleDelete = () => {
        if (!onDelete) return;
        onDelete(competitor.id);
        toast.success(`Deleted @${competitor.handle}`);
    };

    const handleScrape = () => {
        if (!onScrape) return;
        onScrape(competitor.id);
        toast.info(`Starting scrape for @${competitor.handle}...`);
    };

    const isExcludedFromScrape =
        competitor.selectionState === 'FILTERED_OUT' || competitor.selectionState === 'REJECTED';
    const isVerifiedProfile = !competitor.availabilityStatus || competitor.availabilityStatus === 'VERIFIED';
    const isQueueableStatus = competitor.status === 'SUGGESTED' || competitor.status === 'FAILED';
    const canContinueScrape = !isExcludedFromScrape && isVerifiedProfile && isQueueableStatus;

    const getSelectionBadgeVariant = () => {
        const state = competitor.selectionState;
        if (state === 'TOP_PICK') return 'default' as const;
        if (state === 'APPROVED') return 'secondary' as const;
        if (state === 'SHORTLISTED') return 'outline' as const;
        return 'secondary' as const;
    };

    // Get status icon and color
    const getStatusIcon = () => {
        switch (competitor.status) {
            case 'SCRAPED':
                return <CheckCircle className="h-3 w-3 text-green-500" />;
            case 'SCRAPING':
                return <Loader2 className="h-3 w-3 text-yellow-500 animate-spin" />;
            case 'FAILED':
                return <XCircle className="h-3 w-3 text-red-500" />;
            case 'SUGGESTED':
                return <AlertCircle className="h-3 w-3 text-blue-500" />;
            default:
                return null;
        }
    };

    if (isEditing) {
        return (
            <div className={`p-3 rounded-lg border border-primary/50 bg-muted/40 ${className}`}>
                <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                        <label className="text-xs text-muted-foreground">Handle</label>
                        <Input
                            value={editData.handle}
                            onChange={(e) => setEditData({ ...editData, handle: e.target.value })}
                            className="h-8 text-sm"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Platform</label>
                        <Input
                            value={editData.platform}
                            onChange={(e) => setEditData({ ...editData, platform: e.target.value })}
                            className="h-8 text-sm"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Relevance (%)</label>
                        <Input
                            type="number"
                            min="0"
                            max="100"
                            value={Math.round(editData.relevanceScore * 100)}
                            onChange={(e) => setEditData({ ...editData, relevanceScore: Number(e.target.value) / 100 })}
                            className="h-8 text-sm"
                        />
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave}>
                        Save
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`group p-3 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 hover:border-border/80 transition-all ${className}`}
            data-record-type="competitor"
            data-record-id={competitor.id}
            id={`competitor-${competitor.id}`}
        >
            <div className="flex items-center justify-between">
                {/* Left: Handle + Platform */}
                <div className="flex items-center gap-2 flex-1">
                    <a
                        href={competitor.profileUrl || `https://${competitor.platform}.com/${competitor.handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-sm hover:underline flex items-center gap-1"
                    >
                        @{competitor.handle}
                        <ExternalLink className="h-3 w-3 opacity-50" />
                    </a>
                </div>

                {/* Center: Badges */}
                <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] h-5">
                        {competitor.platform}
                    </Badge>

                    {competitor.relevanceScore !== undefined && (
                        <Badge variant="outline" className={`text-[10px] h-5 ${competitor.relevanceScore > 0.8 ? 'border-green-500 text-green-500' : 'border-yellow-500 text-yellow-500'}`}>
                            {Math.round(competitor.relevanceScore * 100)}%
                        </Badge>
                    )}

                    <div className="flex items-center gap-1">
                        {getStatusIcon()}
                        <span className="text-[10px] text-muted-foreground uppercase">{competitor.status}</span>
                    </div>
                    {competitor.selectionState && (
                        <Badge variant={getSelectionBadgeVariant()} className="text-[10px] h-5 uppercase tracking-wide">
                            {competitor.selectionState.replaceAll('_', ' ')}
                        </Badge>
                    )}

                    {competitor.postsScraped !== undefined && competitor.postsScraped > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                            {competitor.postsScraped} posts
                        </span>
                    )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                    <CopyForBatButton
                        recordType="competitor"
                        recordId={competitor.id}
                        getNode={() => document.getElementById(`competitor-${competitor.id}`)}
                    />
                    {onScrape && canContinueScrape && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[10px] px-2 gap-1"
                            onClick={handleScrape}
                            disabled={isScraping || competitor.status === 'SCRAPING'}
                            title="Continue Scrape"
                        >
                            {isScraping || competitor.status === 'SCRAPING' ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Download className="h-3.5 w-3.5" />
                            )}
                            Continue Scrape
                        </Button>
                    )}
                    {onScrape && !canContinueScrape ? (
                        <span className="text-[10px] text-muted-foreground px-2">
                            Not scrape-ready
                        </span>
                    ) : null}

                    {onEdit && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setIsEditing(true)}
                            title="Edit"
                        >
                            <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                    )}

                    {onDelete && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
                                    title="Delete"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Delete @{competitor.handle}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will remove the competitor and all scraped data. This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                                        Delete
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                </div>
            </div>

            {/* Discovery Reason (Footer) */}
            {competitor.discoveryReason && (
                <div className="mt-2 pt-2 border-t border-border/30">
                    <p className="text-[10px] text-muted-foreground truncate" title={competitor.discoveryReason}>
                        Source: {competitor.discoveryReason}
                    </p>
                </div>
            )}
            {competitor.selectionReason && (
                <div className="mt-1">
                    <p className="text-[10px] text-muted-foreground truncate" title={competitor.selectionReason}>
                        Selection: {competitor.selectionReason}
                    </p>
                </div>
            )}
        </div>
    );
}
