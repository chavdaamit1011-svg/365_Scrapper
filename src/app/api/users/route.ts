import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  validateUsername,
  validatePhoneNumber,
  validatePassword,
  validateEmail,
} from '@/lib/validations';
import { ApiResponse, UserSummary } from '@/types';

// GET /api/users - Return list of all users
export async function GET() {
  try {
    const users = db.getAllSummaries();
    return NextResponse.json<ApiResponse<UserSummary[]>>({
      success: true,
      message: 'Users retrieved successfully.',
      data: users,
    });
  } catch (error: any) {
    console.error('[API Users GET Error]:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, message: 'Failed to retrieve users.', error: error.message },
      { status: 500 }
    );
  }
}

// POST /api/users - Create new user with strict restrictions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, phoneNumber, email, password, role } = body;

    // 1. Strict Username Validation
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.isValid) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: usernameValidation.error || 'Invalid username.' },
        { status: 400 }
      );
    }

    // 2. Strict Phone Number Validation
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.isValid) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: phoneValidation.error || 'Invalid phone number.' },
        { status: 400 }
      );
    }

    // 3. Strict Email Validation
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: emailValidation.error || 'Invalid email address.' },
        { status: 400 }
      );
    }

    // 4. Strict Password Validation (Capital, Small, Number, Special Character, Min 8)
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          message: `Password does not meet strict security criteria: ${passwordValidation.errors.join(' ')}`,
          meta: { passwordErrors: passwordValidation.errors },
        },
        { status: 400 }
      );
    }

    // Create user in DB
    const result = await db.createUser({
      username: usernameValidation.normalized!,
      phoneNumber: phoneValidation.normalized!,
      email: emailValidation.normalized!,
      passwordPlain: password,
      role: role || 'user',
    });

    if (result.error) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: result.error },
        { status: 409 }
      );
    }

    return NextResponse.json<ApiResponse<UserSummary>>(
      {
        success: true,
        message: `User "${result.user?.username}" created successfully! They can now log in.`,
        data: result.user,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[API Users POST Error]:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, message: 'Failed to create user.', error: error.message },
      { status: 500 }
    );
  }
}

