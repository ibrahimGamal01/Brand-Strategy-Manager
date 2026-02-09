'use client';

import { MessageSquare, Database as DatabaseIcon } from 'lucide-react';
import { TreeNodeCard, DataList } from './';

interface BrandReputationNodeProps {
    brandMentions: any[];
}

export function BrandReputationNode({ brandMentions }: BrandReputationNodeProps) {
    return (
        <TreeNodeCard
            title="Brand Reputation"
            icon={<MessageSquare className="h-4 w-4" />}
            count={brandMentions.length}
            defaultExpanded={false}
            level={1}
        >
            <TreeNodeCard
                title="Web Mentions"
                icon={<DatabaseIcon className="h-3 w-3" />}
                count={brandMentions.length}
                level={2}
                defaultExpanded={true}
            >
                <DataList
                    items={brandMentions.map((mention: any, idx: number) => ({
                        id: mention.id || idx.toString(),
                        title: mention.title || mention.sourceType || 'Mention',
                        subtitle: mention.sourceType,
                        content: mention.snippet || mention.fullText,
                        url: mention.url
                    }))}
                    emptyMessage="No brand mentions found"
                />
            </TreeNodeCard>
        </TreeNodeCard>
    );
}
