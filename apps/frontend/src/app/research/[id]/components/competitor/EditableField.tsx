'use client';

import { useState } from 'react';
import { Edit2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface EditableFieldProps {
    label: string;
    value: string | number | string[];
    onSave?: (value: string | number | string[]) => void;
    type?: 'text' | 'number' | 'array';
    placeholder?: string;
    className?: string;
}

/**
 * EditableField - Inline editable field with save/cancel
 * Supports text, number, and array (comma-separated) values
 */
export function EditableField({
    label,
    value,
    onSave,
    type = 'text',
    placeholder,
    className = ''
}: EditableFieldProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(
        Array.isArray(value) ? value.join(', ') : String(value)
    );

    const handleSave = () => {
        if (!onSave) return;

        let finalValue: string | number | string[];

        if (type === 'array') {
            finalValue = editValue.split(',').map(v => v.trim()).filter(Boolean);
        } else if (type === 'number') {
            finalValue = Number(editValue);
        } else {
            finalValue = editValue;
        }

        onSave(finalValue);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditValue(Array.isArray(value) ? value.join(', ') : String(value));
        setIsEditing(false);
    };

    const displayValue = Array.isArray(value) ? value.join(', ') : value;

    if (!isEditing) {
        return (
            <div className={`flex items-center justify-between py-1.5 ${className}`}>
                <span className="text-xs text-muted-foreground">{label}:</span>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{displayValue}</span>
                    {onSave && (
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
        );
    }

    return (
        <div className={`flex items-center justify-between gap-2 py-1.5 ${className}`}>
            <span className="text-xs text-muted-foreground">{label}:</span>
            <div className="flex items-center gap-1">
                <Input
                    type={type === 'number' ? 'number' : 'text'}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder={placeholder}
                    className="h-7 text-sm w-40"
                    autoFocus
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave();
                        if (e.key === 'Escape') handleCancel();
                    }}
                />
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
            </div>
        </div>
    );
}
