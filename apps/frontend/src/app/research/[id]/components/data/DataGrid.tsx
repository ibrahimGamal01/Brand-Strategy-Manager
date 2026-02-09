'use client';

import { Loader2 } from 'lucide-react';
import { DataCard } from './DataCard';
import { DataCardConfig } from './types';

interface DataGridProps<T> {
    data: T[];
    config: (item: T) => Omit<DataCardConfig<T>, 'data'>;
    loading?: boolean;
    emptyMessage?: string;
    className?: string;
    columns?: {
        sm?: number;
        md?: number;
        lg?: number;
        xl?: number;
    };
}

export function DataGrid<T extends { id: string }>({
    data,
    config,
    loading = false,
    emptyMessage = 'No items found',
    className = '',
    columns = { sm: 1, md: 2, lg: 3, xl: 4 }
}: DataGridProps<T>) {
    if (loading) {
        return (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span>Loading data...</span>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="p-8 border border-dashed border-border rounded-lg text-center text-muted-foreground bg-muted/10">
                <p className="text-sm">{emptyMessage}</p>
            </div>
        );
    }

    const getGridCols = () => {
        const { sm = 1, md = 2, lg = 3, xl = 4 } = columns;
        return `grid-cols-${sm} md:grid-cols-${md} lg:grid-cols-${lg} xl:grid-cols-${xl}`;
    };

    return (
        <div className={`grid gap-4 ${getGridCols()} ${className}`}>
            {data.map((item) => {
                const itemConfig = config(item);
                return (
                    <DataCard
                        key={item.id}
                        data={item}
                        {...itemConfig}
                    />
                );
            })}
        </div>
    );
}
