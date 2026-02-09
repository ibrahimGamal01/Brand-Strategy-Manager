'use client';

import { useState } from 'react';
import { Edit2, Check, X, ExternalLink, Calendar, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldSchema } from './types';

interface FieldEditorProps {
    field: FieldSchema;
    value: any;
    onSave?: (value: any) => void;
    className?: string;
}

/**
 * FieldEditor - Universal inline field editor
 * Supports: text, number, textarea, url, date, image, array
 */
export function FieldEditor({ field, value, onSave, className = '' }: FieldEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const [error, setError] = useState<string | null>(null);

    const handleSave = () => {
        // Validate if validation function provided
        if (field.validation) {
            const validationError = field.validation(editValue);
            if (validationError) {
                setError(validationError);
                return;
            }
        }

        if (onSave) {
            onSave(editValue);
        }
        setIsEditing(false);
        setError(null);
    };

    const handleCancel = () => {
        setEditValue(value);
        setIsEditing(false);
        setError(null);
    };

    // Custom renderer override
    if (field.render && !isEditing) {
        return (
            <div className={`py-1.5 ${className}`}>
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{field.label}:</span>
                    <div className="flex items-center gap-2">
                        {field.render(value, {})}
                        {field.editable && onSave && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => setIsEditing(true)}
                            >
                                <Edit2 className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // View mode
    if (!isEditing) {
        return (
            <div className={`py-1.5 ${className}`}>
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{field.label}:</span>
                    <div className="flex items-center gap-2">
                        {renderValue(field, value)}
                        {field.editable && onSave && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => setIsEditing(true)}
                            >
                                <Edit2 className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Edit mode
    return (
        <div className={`py-1.5 ${className}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{field.label}:</span>
                <div className="flex-1 flex items-center gap-1">
                    {renderEditor(field, editValue, setEditValue, handleSave, handleCancel)}
                </div>
            </div>
            {error && (
                <p className="text-xs text-destructive mt-1">{error}</p>
            )}
        </div>
    );
}

// Render value in view mode
function renderValue(field: FieldSchema, value: any) {
    if (value === null || value === undefined || value === '') {
        return <span className="text-sm text-muted-foreground italic">-</span>;
    }

    switch (field.type) {
        case 'url':
            return (
                <a
                    href={value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:underline flex items-center gap-1"
                >
                    {truncate(value, 40)}
                    <ExternalLink className="h-3 w-3" />
                </a>
            );
        case 'image':
            return (
                <div className="w-16 h-16 rounded border overflow-hidden bg-muted">
                    <img src={value} alt="" className="w-full h-full object-cover" />
                </div>
            );
        case 'array':
            return (
                <div className="flex flex-wrap gap-1">
                    {Array.isArray(value) && value.map((item, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full bg-muted text-xs">
                            {item}
                        </span>
                    ))}
                </div>
            );
        case 'date':
            return (
                <span className="text-sm font-medium flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(value).toLocaleDateString()}
                </span>
            );
        case 'boolean':
            return (
                <span className={`text-sm font-medium ${value ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {value ? 'Yes' : 'No'}
                </span>
            );
        case 'textarea':
            return <span className="text-sm font-medium">{truncate(value, 60)}</span>;
        default:
            return <span className="text-sm font-medium">{value}</span>;
    }
}

// Render editor in edit mode
function renderEditor(
    field: FieldSchema,
    editValue: any,
    setEditValue: (value: any) => void,
    handleSave: () => void,
    handleCancel: () => void
) {
    const commonProps = {
        autoFocus: true,
        onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && field.type !== 'textarea') handleSave();
            if (e.key === 'Escape') handleCancel();
        }
    };

    let editor;
    switch (field.type) {
        case 'textarea':
            editor = (
                <Textarea
                    value={editValue || ''}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder={field.placeholder}
                    className="h-20 text-sm resize-none"
                    {...commonProps}
                />
            );
            break;
        case 'number':
            editor = (
                <Input
                    type="number"
                    value={editValue || ''}
                    onChange={(e) => setEditValue(Number(e.target.value))}
                    placeholder={field.placeholder}
                    className="h-7 text-sm flex-1"
                    {...commonProps}
                />
            );
            break;
        case 'array':
            editor = (
                <Input
                    value={Array.isArray(editValue) ? editValue.join(', ') : editValue}
                    onChange={(e) => setEditValue(e.target.value.split(',').map(v => v.trim()))}
                    placeholder={field.placeholder || 'Comma-separated values'}
                    className="h-7 text-sm flex-1"
                    {...commonProps}
                />
            );
            break;
        default:
            editor = (
                <Input
                    type={field.type === 'url' ? 'url' : field.type === 'date' ? 'date' : 'text'}
                    value={editValue || ''}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder={field.placeholder}
                    className="h-7 text-sm flex-1"
                    {...commonProps}
                />
            );
    }

    return (
        <>
            {editor}
            <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 hover:bg-green-500/10 hover:text-green-500"
                onClick={handleSave}
            >
                <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                onClick={handleCancel}
            >
                <X className="h-3.5 w-3.5" />
            </Button>
        </>
    );
}

function truncate(str: string, maxLen: number) {
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}
