import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiResponse } from '@/types';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: 'User ID is required.' },
        { status: 400 }
      );
    }

    if (id === 'usr_fixed_jon') {
      return NextResponse.json<ApiResponse>(
        { success: false, message: 'Primary fixed operator cannot be deleted.' },
        { status: 403 }
      );
    }

    const deleted = db.deleteUser(id);
    if (!deleted) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: 'User not found or already deleted.' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'User deleted successfully.',
    });
  } catch (error: any) {
    console.error('[API Users DELETE Error]:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, message: 'Failed to delete user.', error: error.message },
      { status: 500 }
    );
  }
}

