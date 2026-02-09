'use client';

import { ReactNode } from 'react';
import { Settings } from 'lucide-react';
import { EditableField } from './EditableField';

interface SettingsConfig {
    [key: string]: {
        label: string;
        value: string | number | string[];
        type?: 'text' | 'number' | 'array';
        placeholder?: string;
    };
}

interface SettingsSectionProps {
    config: SettingsConfig;
    onSave?: (key: string, value: string | number | string[]) => void;
    className?: string;
    children?: ReactNode;
}

/**
 * SettingsSection - Editable settings panel with grouped fields
 * Features:
 * - Display multiple editable fields
 * - Save handler for each field
 * - Collapsible design
 */
export function SettingsSection({
    config,
    onSave,
    className = '',
    children
}: SettingsSectionProps) {
    return (
        <div className={`space-y-1 ${className}`}>
            <div className="flex items-center gap-2 mb-2">
                <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                <h5 className="text-xs font-medium text-muted-foreground uppercase">Settings</h5>
            </div>

            <div className="pl-5 space-y-0.5 border-l-2 border-border/30">
                {Object.entries(config).map(([key, setting]) => (
                    <div key={key} className="group">
                        <EditableField
                            label={setting.label}
                            value={setting.value}
                            type={setting.type}
                            placeholder={setting.placeholder}
                            onSave={onSave ? (value) => onSave(key, value) : undefined}
                        />
                    </div>
                ))}
                {children}
            </div>
        </div>
    );
}
