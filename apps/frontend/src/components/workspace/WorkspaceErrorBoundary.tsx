'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WorkspaceErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
}

interface WorkspaceErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class WorkspaceErrorBoundary extends React.Component<WorkspaceErrorBoundaryProps, WorkspaceErrorBoundaryState> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: null,
    };
  }

  static getDerivedStateFromError(error: Error): WorkspaceErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message,
    };
  }

  componentDidCatch(error: Error) {
    console.error('[BAT Workspace] Module render failure:', error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
          <div className="space-y-2">
            <h3 className="font-semibold">{this.props.title || 'Module failed to render'}</h3>
            <p className="text-muted-foreground">
              BAT caught a runtime issue and isolated this panel to keep the workspace usable.
            </p>
            {this.state.errorMessage ? (
              <p className="rounded border border-destructive/40 bg-background/60 px-2 py-1 font-mono text-xs">
                {this.state.errorMessage}
              </p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: null });
              }}
            >
              Retry Module
            </Button>
          </div>
        </div>
      </section>
    );
  }
}
