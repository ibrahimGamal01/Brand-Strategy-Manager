import { Globe, Building2, Package, Clock } from 'lucide-react';
import type { Client, ResearchJob } from '@/types/brand-strategy';
import { Badge } from '@/components/ui/badge';

interface ClientHeaderProps {
  client: Client;
  job: ResearchJob;
}

const statusConfig = {
  PENDING: { variant: 'pending' as const, label: 'Pending' },
  SCRAPING: { variant: 'warning' as const, label: 'Scraping Data' },
  ANALYZING: { variant: 'processing' as const, label: 'AI Analyzing' },
  COMPLETE: { variant: 'success' as const, label: 'Complete' },
};

export function ClientHeader({ client, job }: ClientHeaderProps) {
  const status = statusConfig[job.status];

  return (
    <div className="border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="container mx-auto px-6 py-5">
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                <Building2 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Globe className="h-3.5 w-3.5" />
                  <a 
                    href={client.website} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="hover:text-primary transition-colors"
                  >
                    {client.website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              </div>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground leading-relaxed">
              {client.businessOverview}
            </p>
            <div className="flex items-center gap-2">
              {client.productsServices.map((service) => (
                <Badge key={service} variant="secondary" className="text-xs">
                  <Package className="h-3 w-3 mr-1" />
                  {service}
                </Badge>
              ))}
            </div>
          </div>
          
          <div className="text-right space-y-2">
            <Badge variant={status.variant} className="text-sm px-3 py-1">
              {job.status === 'ANALYZING' && (
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-processing animate-pulse" />
              )}
              {status.label}
            </Badge>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground justify-end">
              <Clock className="h-3 w-3" />
              <span>Started {new Date(job.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Job ID: <span className="font-mono text-primary">{job.id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
