'use client';

import { useState } from 'react';
import { Edit2, Trash2, MoreVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { FieldEditor } from './FieldEditor';
import { DataCardConfig } from './types';

interface DataCardProps extends DataCardConfig {
    className?: string;
}

export function DataCard({
    data,
    schema,
    title,
    icon: Icon,
    actions = [],
    onEdit,
    onDelete,
    compact = false,
    defaultExpanded = false,
    className = ''
}: DataCardProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    // Filter visible fields based on compact mode and expansion
    const visibleFields = schema;

    return (
        <div className={`group rounded-lg border border-border bg-card text-card-foreground shadow-sm hover:border-primary/50 transition-all ${className}`}>
            {/* Header */}
            <div className="flex items-start justify-between p-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
                    {title && (
                        <h4 className="font-semibold text-sm truncate" title={title}>
                            {title}
                        </h4>
                    )}
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                    {actions.map((action, i) => (
                        (!action.show || action.show(data)) && (
                            <Button
                                key={i}
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => action.onClick(data)}
                                title={action.label}
                            >
                                <action.icon className="h-3.5 w-3.5" />
                            </Button>
                        )
                    ))}

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
                                    <AlertDialogTitle>Delete Item?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This action cannot be undone. This will permanently delete this item.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={() => onDelete((data as any).id)}
                                        className="bg-destructive hover:bg-destructive/90"
                                    >
                                        Delete
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="px-3 pb-3 space-y-1">
                {visibleFields.map((field) => (
                    <FieldEditor
                        key={field.key}
                        field={field}
                        value={(data as any)[field.key]}
                        onSave={onEdit ? (value) => onEdit((data as any).id, { [field.key]: value } as any) : undefined}
                    />
                ))}
            </div>
        </div>
    );
}
