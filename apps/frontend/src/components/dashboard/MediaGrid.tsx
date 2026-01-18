import { useState } from 'react';
import { Download, ExternalLink, Play, Code, Image, Video } from 'lucide-react';
import type { DdgImageResult, DdgVideoResult } from '@/types/brand-strategy';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MediaGridProps {
  images: DdgImageResult[];
  videos: DdgVideoResult[];
}

export function MediaGrid({ images, videos }: MediaGridProps) {
  const [showJson, setShowJson] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'images' | 'videos'>('all');

  const allMedia = [
    ...images.map(img => ({ ...img, type: 'image' as const })),
    ...videos.map(vid => ({ ...vid, type: 'video' as const })),
  ];

  const filteredMedia = activeTab === 'all' 
    ? allMedia 
    : activeTab === 'images' 
      ? allMedia.filter(m => m.type === 'image')
      : allMedia.filter(m => m.type === 'video');

  return (
    <Card variant="glass">
      <CardHeader className="border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Media Findings</CardTitle>
            <div className="flex gap-1">
              {(['all', 'images', 'videos'] as const).map((tab) => (
                <Button
                  key={tab}
                  variant={activeTab === tab ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2.5 text-xs capitalize"
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'images' && <Image className="h-3 w-3 mr-1" />}
                  {tab === 'videos' && <Video className="h-3 w-3 mr-1" />}
                  {tab}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {images.length} images · {videos.length} videos
            </span>
            <Button 
              variant="terminal" 
              size="sm" 
              onClick={() => setShowJson(!showJson)}
              className="h-7 px-2"
            >
              <Code className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {showJson ? (
          <pre className="p-4 rounded-lg bg-background/50 text-xs overflow-auto max-h-96 custom-scrollbar text-muted-foreground">
            <code>{JSON.stringify({ images, videos }, null, 2)}</code>
          </pre>
        ) : (
          <div className="masonry-grid">
            {filteredMedia.map((media) => (
              <div key={media.id} className="masonry-item">
                <div className="group relative rounded-lg overflow-hidden bg-muted/30 border border-border/50 hover:border-primary/50 transition-all duration-200">
                  <div className="relative aspect-video">
                    <img
                      src={media.thumbnailUrl}
                      alt={media.title}
                      className="w-full h-full object-cover"
                    />
                    {media.type === 'video' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/90 text-primary-foreground">
                          <Play className="h-5 w-5 ml-0.5" />
                        </div>
                      </div>
                    )}
                    {media.type === 'video' && 'duration' in media && (
                      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-background/80 text-xs font-mono">
                        {media.duration}
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex gap-1">
                      <Badge variant={media.type === 'image' ? 'secondary' : 'default'} className="text-[10px]">
                        {media.type === 'image' ? <Image className="h-3 w-3 mr-1" /> : <Video className="h-3 w-3 mr-1" />}
                        {media.type.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="absolute top-2 right-2">
                      <Badge 
                        variant={media.isDownloaded ? 'success' : 'pending'} 
                        className="text-[10px]"
                      >
                        {media.isDownloaded ? (
                          <>
                            <Download className="h-3 w-3 mr-1" />
                            Saved
                          </>
                        ) : 'Pending'}
                      </Badge>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <p className="text-xs line-clamp-2 text-muted-foreground">
                      {media.title}
                    </p>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <a
                        href={media.type === 'image' ? (media as DdgImageResult).imageUrl : (media as DdgVideoResult).url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1"
                      >
                        <Button variant="secondary" size="sm" className="w-full h-7 text-xs">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View
                        </Button>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
