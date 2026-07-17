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
import { ArrowUpDown, Eye, MoreHorizontal, ExternalLink } from 'lucide-react';

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
import { InlineStatusSelect } from './inline-status-select';

interface BugReportsDataTableProps {
  data: BugReport[];
  organizationSlug: string;
  applications: Application[];
  applicationsLoading?: boolean;
  onStatusChange?: () => void;
  initialAppSlug?: string;
  /** Reports the currently-filtered application id upward (undefined = all apps). */
  onSelectedAppChange?: (applicationId: string | undefined) => void;
}

export function BugReportsDataTable({
  data,
  organizationSlug,
  applications,
  applicationsLoading = false,
  onStatusChange,
  initialAppSlug,
  onSelectedAppChange
}: BugReportsDataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'created_at', desc: true }
  ]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [globalFilter, setGlobalFilter] = React.useState('');

  const columns: ColumnDef<BugReport>[] = [
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
            <Link href={`/org/${organizationSlug}/bugs/${row.original.id}`}>
              <div className='font-medium truncate hover:underline'>
                {title}
              </div>
            </Link>
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
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      }
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }) => (
        <div className='capitalize'>{row.getValue('category')}</div>
      ),
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      }
    },
    {
      accessorKey: 'application',
      header: 'Application',
      cell: ({ row }) => {
        const app = row.original.application;
        return <div className='font-medium'>{app?.name || 'Unknown'}</div>;
      },
      filterFn: (row, id, value) => {
        if (!value || value === 'all') return true;
        const app = row.original.application;
        return app?.id === value;
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
        );
      }
    }
  ];

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter
    }
  });

  const initialAppApplied = React.useRef(false);
  React.useEffect(() => {
    if (initialAppApplied.current) return;
    if (!initialAppSlug || applications.length === 0) return;
    const match = applications.find((a) => a.slug === initialAppSlug);
    if (!match) return;
    table.getColumn('application')?.setFilterValue(match.id);
    onSelectedAppChange?.(match.id);
    initialAppApplied.current = true;
  }, [initialAppSlug, applications, table, onSelectedAppChange]);

  return (
    <div className='w-full space-y-4'>
      {/* Filter Section */}
      <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <Input
          placeholder='Search by title, description, or reporter...'
          value={globalFilter ?? ''}
          onChange={(event) => setGlobalFilter(event.target.value)}
          className='max-w-md'
        />

        <div className='flex flex-wrap gap-2'>
          {/* Application Filter */}
          <Select
            value={
              (table.getColumn('application')?.getFilterValue() as string) ??
              'all'
            }
            onValueChange={(value) => {
              table
                .getColumn('application')
                ?.setFilterValue(value === 'all' ? '' : value);
              onSelectedAppChange?.(value === 'all' ? undefined : value);
            }}
            disabled={applicationsLoading || applications.length === 0}
          >
            <SelectTrigger className='w-[200px]'>
              <SelectValue placeholder='All Applications' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Applications</SelectItem>
              {applications.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                  {app.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select
            value={
              (table.getColumn('status')?.getFilterValue() as string) ?? 'all'
            }
            onValueChange={(value) =>
              table
                .getColumn('status')
                ?.setFilterValue(value === 'all' ? '' : value)
            }
          >
            <SelectTrigger className='w-[160px]'>
              <SelectValue placeholder='All Status' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Status</SelectItem>
              <SelectItem value='new'>New</SelectItem>
              <SelectItem value='seen'>Seen</SelectItem>
              <SelectItem value='in_progress'>In Progress</SelectItem>
              <SelectItem value='resolved'>Resolved</SelectItem>
              <SelectItem value='wont_fix'>Won&apos;t Fix</SelectItem>
            </SelectContent>
          </Select>

          {/* Category Filter */}
          <Select
            value={
              (table.getColumn('category')?.getFilterValue() as string) ?? 'all'
            }
            onValueChange={(value) =>
              table
                .getColumn('category')
                ?.setFilterValue(value === 'all' ? '' : value)
            }
          >
            <SelectTrigger className='w-[180px]'>
              <SelectValue placeholder='All Categories' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Categories</SelectItem>
              <SelectItem value='bug'>Bug</SelectItem>
              <SelectItem value='feature_request'>Feature Request</SelectItem>
              <SelectItem value='ui_design'>UI/Design</SelectItem>
              <SelectItem value='performance'>Performance</SelectItem>
              <SelectItem value='security'>Security</SelectItem>
              <SelectItem value='other'>Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

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
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className='cursor-pointer hover:bg-muted/50'
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
