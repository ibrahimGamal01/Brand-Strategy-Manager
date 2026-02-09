'use client';

import {
    Search, ImageIcon, Video, Newspaper
} from 'lucide-react';
import { TreeNodeCard } from './TreeNodeCard';
import { SearchResultsList } from '../search/SearchResultsList';
import { ImageGallery } from '../search/ImageGallery';
import { VideoGallery } from '../search/VideoGallery';
import { NewsGallery } from '../search/NewsGallery';

interface SearchDataNodeProps {
    searchResults: any[];
    images: any[];
    videos: any[];
    news: any[];
}

export function SearchDataNode({ searchResults, images, videos, news }: SearchDataNodeProps) {
    return (
        <TreeNodeCard
            title="Search Data"
            icon={<Search className="h-4 w-4" />}
            count={searchResults.length + images.length + videos.length + news.length}
            defaultExpanded={false}
            level={1}
        >
            {/* Search Results */}
            <TreeNodeCard
                title="Search Results"
                icon={<Search className="h-3 w-3" />}
                count={searchResults.length}
                level={2}
                defaultExpanded={searchResults.length > 0}
            >
                <div className="px-4 py-3">
                    <SearchResultsList results={searchResults.map((result: any, idx: number) => ({
                        id: result.id || idx.toString(),
                        title: result.title || result.name || 'Untitled',
                        snippet: result.snippet || result.description || result.body,
                        url: result.url || result.link,
                        source: result.source
                    }))} />
                </div>
            </TreeNodeCard>

            {/* Images */}
            <TreeNodeCard
                title="Images"
                icon={<ImageIcon className="h-3 w-3" />}
                count={images.length}
                level={2}
                defaultExpanded={images.length > 0 && images.length <= 30}
            >
                <div className="px-4 py-3">
                    <ImageGallery images={images} />
                </div>
            </TreeNodeCard>

            {/* Videos  */}
            <TreeNodeCard
                title="Videos"
                icon={<Video className="h-3 w-3" />}
                count={videos.length}
                level={2}
                defaultExpanded={videos.length > 0 && videos.length <= 15}
            >
                <div className="px-4 py-3">
                    <VideoGallery videos={videos} />
                </div>
            </TreeNodeCard>

            {/* News */}
            <TreeNodeCard
                title="News"
                icon={<Newspaper className="h-3 w-3" />}
                count={news.length}
                level={2}
                defaultExpanded={news.length > 0 && news.length <= 10}
            >
                <div className="px-4 py-3">
                    <NewsGallery news={news.map((article: any, idx: number) => ({
                        id: article.id || idx.toString(),
                        title: article.title || 'Untitled Article',
                        body: article.excerpt || article.description || article.body,
                        url: article.url || article.link,
                        source: article.source,
                        imageUrl: article.imageUrl,
                        publishedAt: article.publishedAt
                    }))} />
                </div>
            </TreeNodeCard>
        </TreeNodeCard>
    );
}
