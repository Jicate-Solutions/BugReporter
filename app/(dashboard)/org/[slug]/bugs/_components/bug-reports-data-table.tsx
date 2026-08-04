'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import {
  ArrowUpDown,
  Eye,
  MoreHorizontal,
  ExternalLink,
  Loader2,
  X
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { BugReport, Application } from '@boobalan_jkkn/shared';
import {
  BUG_STATUSES,
  BUG_STATUS_LABELS,
  type BugReportStatus
} from '@boobalan_jkkn/shared';
import { InlineStatusSelect } from './inline-status-select';
import {
  hasActiveFilters,
  type BugFilters
} from '@/hooks/bug-reports/use-bug-filters';

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'ui_design', label: 'UI/Design' },
  { value: 'performance', label: 'Performance' },
  { value: 'security', label: 'Security' },
  { value: 'other', label: 'Other' }
];

interface BugReportsDataTableProps {
  data: BugReport[];
  organizationSlug: string;
  applications: Application[];
  applicationsLoading?: boolean;
  onStatusChange?: () => void;
  /**
   * Filters are owned by the page, not by this table. They used to be local
   * state here, which meant a refetch that unmounted the table wiped them.
   */
  filters: BugFilters;
  onFiltersChange: (patch: Partial<BugFilters>) => void;
  /** Shown while a background refetch is in flight; the table stays mounted. */
  refreshing?: boolean;
}

export function BugReportsDataTable({
  data,
  organizationSlug,
  applications,
  applicationsLoading = false,
  onStatusChange,
  filters,
  onFiltersChange,
  refreshing = false
}: BugReportsDataTableProps) {
  const router = useRouter();

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'created_at', desc: true }
  ]);
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});

  // Derived from the page's filters rather than held locally, so the table has
  // no filter state of its own left to lose.
  const columnFilters = React.useMemo<ColumnFiltersState>(() => {
    const next: ColumnFiltersState = [];
    if (filters.status) next.push({ id: 'status', value: filters.status });
    if (filters.category) next.push({ id: 'category', value: filters.category });
    if (filters.app) next.push({ id: 'application', value: filters.app });
    return next;
  }, [filters.status, filters.category, filters.app]);

  const columns: ColumnDef<BugReport>[] = React.useMemo(() => [
    {
      accessorKey: 'display_id',
      header: 'ID',
      cell: ({ row }) => (
        <div className='font-mono text-sm'>
          {row.getValue('display_id') || `#${row.original.id.slice(0, 8)}`}
        </div>
      )
    },
    {
      accessorKey: 'title',
      header: ({ column }) => {
        return (
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === 'asc')
              }
            >
              Title
              <ArrowUpDown className='ml-2 h-4 w-4' />
            </Button>
          </div>
        );
      },
      cell: ({ row }) => {
        const title = String(row.getValue('title') || 'Untitled');
        const description = row.original.description || '';
        return (
          <div className='max-w-[500px]'>
            <div className='font-medium truncate hover:underline'>{title}</div>
            <div className='text-sm text-muted-foreground line-clamp-1'>
              {description}
            </div>
          </div>
        );
      }
    },
    {
      accessorKey: 'status',
      header: ({ column }) => {
        return (
          <Button
            variant='ghost'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Status
            <ArrowUpDown className='ml-2 h-4 w-4' />
          </Button>
        );
      },
      cell: ({ row }) => (
        <InlineStatusSelect
          bugId={row.original.id}
          currentStatus={row.getValue('status')}
          onSuccess={onStatusChange}
        />
      ),
      // Equality, not `value.includes(...)`. The filter value is a string, so
      // includes() was String.prototype.includes — a substring match that
      // happens to be right only because no status contains another. Adding a
      // 'progress' status beside 'in_progress' would have matched both.
      filterFn: (row, id, value) => !value || row.getValue(id) === value
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => (
        <div className='capitalize'>{row.getValue('category')}</div>
      ),
      filterFn: (row, id, value) => !value || row.getValue(id) === value
    },
    {
      accessorKey: 'application',
      header: 'Application',
      cell: ({ row }) => {
        const app = row.original.application;
        return <div className='font-medium'>{app?.name || 'Unknown'}</div>;
      },
      // Matched on slug, because that is what lives in the URL.
      filterFn: (row, id, value) => {
        if (!value || value === 'all') return true;
        return row.original.application?.slug === value;
      }
    },
    {
      accessorKey: 'reporter',
      header: 'Reporter',
      cell: ({ row }) => {
        const reporterName = row.original.reporter_name;
        const reporterEmail = row.original.reporter_email;
        return (
          <div className='text-sm'>
            {reporterName || reporterEmail || 'Anonymous'}
          </div>
        );
      }
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => {
        return (
          <Button
            variant='ghost'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Created
            <ArrowUpDown className='ml-2 h-4 w-4' />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = new Date(row.getValue('created_at'));
        return (
          <div className='text-sm'>
            {date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </div>
        );
      }
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => {
        const bug = row.original;

        return (
          // Rows navigate on click now, so this menu must not bubble — otherwise
          // "Copy bug ID" would also open the bug.
          <div onClick={(e) => e.stopPropagation()} className='w-fit'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' className='h-8 w-8 p-0'>
                <span className='sr-only'>Open menu</span>
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(bug.id)}
              >
                Copy bug ID
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/org/${organizationSlug}/bugs/${bug.id}`}>
                  <Eye className='mr-2 h-4 w-4' />
                  View details
                </Link>
              </DropdownMenuItem>
              {bug.page_url && (
                <DropdownMenuItem asChild>
                  <a
                    href={bug.page_url}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    <ExternalLink className='mr-2 h-4 w-4' />
                    Visit page
                  </a>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        );
      }
    }
  ], [organizationSlug, onStatusChange]);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: 'includesString',
    // Without this the page index snaps back to 1 whenever `data` gets a new
    // identity, which it does on every background refetch.
    autoResetPageIndex: false,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: filters.q
    }
  });

  return (
    <div className='w-full space-y-4'>
      {/* Filter Section */}
      <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <div className='flex items-center gap-2'>
          <Input
            placeholder='Search by ID, title, description, or reporter...'
            value={filters.q}
            onChange={(event) => onFiltersChange({ q: event.target.value })}
            className='max-w-md'
          />
          {refreshing && (
            <Loader2 className='h-4 w-4 shrink-0 animate-spin text-muted-foreground' />
          )}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {/* Application Filter — value is the slug, matching the URL */}
          <Select
            value={filters.app || 'all'}
            onValueChange={(value) =>
              onFiltersChange({ app: value === 'all' ? '' : value })
            }
            disabled={applicationsLoading || applications.length === 0}
          >
            <SelectTrigger className='w-[200px]'>
              <SelectValue placeholder='All Applications' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Applications</SelectItem>
              {applications.map((app) => (
                <SelectItem key={app.id} value={app.slug}>
                  {app.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter — options come from the shared vocabulary */}
          <Select
            value={filters.status || 'all'}
            onValueChange={(value) =>
              onFiltersChange({ status: value === 'all' ? '' : value })
            }
          >
            <SelectTrigger className='w-[160px]'>
              <SelectValue placeholder='All Status' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Status</SelectItem>
              {BUG_STATUSES.map((status: BugReportStatus) => (
                <SelectItem key={status} value={status}>
                  {BUG_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Category Filter */}
          <Select
            value={filters.category || 'all'}
            onValueChange={(value) =>
              onFiltersChange({ category: value === 'all' ? '' : value })
            }
          >
            <SelectTrigger className='w-[180px]'>
              <SelectValue placeholder='All Categories' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Categories</SelectItem>
              {CATEGORY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters(filters) && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() =>
                onFiltersChange({ q: '', status: '', category: '', app: '' })
              }
            >
              <X className='mr-1 h-4 w-4' />
              Clear
            </Button>
          )}
        </div>
      </div>

      <p className='text-sm text-muted-foreground'>
        {table.getFilteredRowModel().rows.length === data.length
          ? `${data.length} bug${data.length === 1 ? '' : 's'}`
          : `${table.getFilteredRowModel().rows.length} of ${data.length} bugs`}
      </p>

      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                // The row carried `cursor-pointer` but had no handler, so it
                // looked clickable and wasn't. Navigation is keyed off
                // row.original.id — never an index, which sorting or pagination
                // would desync from what is on screen.
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className='cursor-pointer hover:bg-muted/50'
                  onClick={() =>
                    router.push(
                      `/org/${organizationSlug}/bugs/${row.original.id}`
                    )
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center'
                >
                  No bugs found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-between px-2'>
        <div className='flex-1 text-sm text-muted-foreground'>
          {table.getFilteredRowModel().rows.length} of{' '}
          {table.getCoreRowModel().rows.length} bug(s) shown
        </div>
        <div className='flex items-center space-x-6 lg:space-x-8'>
          <div className='flex items-center space-x-2'>
            <p className='text-sm font-medium'>Rows per page</p>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
              }}
            >
              <SelectTrigger className='h-8 w-[70px]'>
                <SelectValue
                  placeholder={table.getState().pagination.pageSize}
                />
              </SelectTrigger>
              <SelectContent side='top'>
                {[10, 20, 30, 40, 50].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex w-[100px] items-center justify-center text-sm font-medium'>
            Page {table.getState().pagination.pageIndex + 1} of{' '}
            {table.getPageCount()}
          </div>
          <div className='flex items-center space-x-2'>
            <Button
              variant='outline'
              className='h-8 w-8 p-0'
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className='sr-only'>Go to first page</span>
              {'<<'}
            </Button>
            <Button
              variant='outline'
              className='h-8 w-8 p-0'
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className='sr-only'>Go to previous page</span>
              {'<'}
            </Button>
            <Button
              variant='outline'
              className='h-8 w-8 p-0'
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className='sr-only'>Go to next page</span>
              {'>'}
            </Button>
            <Button
              variant='outline'
              className='h-8 w-8 p-0'
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className='sr-only'>Go to last page</span>
              {'>>'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
