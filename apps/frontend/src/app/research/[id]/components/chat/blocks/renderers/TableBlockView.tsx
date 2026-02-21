import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from '@/components/ui/table';
import type { TableBlock } from '../types';

interface TableBlockViewProps {
  block: TableBlock;
}

export function TableBlockView({ block }: TableBlockViewProps) {
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            {block.columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(block.rows || []).map((row, rowIndex) => (
            <TableRow key={`${block.blockId}-row-${rowIndex}`}>
              {block.columns.map((column) => (
                <TableCell key={`${block.blockId}-${rowIndex}-${column}`}>
                  {row?.[column] ?? '—'}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {block.caption ? <TableCaption>{block.caption}</TableCaption> : null}
      </Table>
    </div>
  );
}

