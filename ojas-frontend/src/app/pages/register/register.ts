import { Component, ChangeDetectorRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  AsyncValidatorFn,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import { timeout, of, switchMap, map, catchError, timer } from 'rxjs';

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class Register {
  registerForm: FormGroup;
  loading = false;
  hidePassword = true;
  serverError = '';

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {
    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      email: [
        '',
        {
          validators: [Validators.required, Validators.email],
          asyncValidators: [this.emailExistsValidator()],
          updateOn: 'blur',
        },
      ],
      phone: [
        '',
        {
          validators: [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)],
          asyncValidators: [this.phoneExistsValidator()],
          updateOn: 'blur',
        },
      ],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  private emailExistsValidator(): AsyncValidatorFn {
    return (control: AbstractControl) => {
      if (!control.value || control.hasError('email') || control.hasError('required')) {
        return of(null);
      }
      return timer(200).pipe(
        switchMap(() => this.auth.checkEmail(control.value)),
        map((res) => (res.exists ? { serverError: 'Email already registered' } : null)),
        catchError(() => of(null)),
      );
    };
  }

  private phoneExistsValidator(): AsyncValidatorFn {
    return (control: AbstractControl) => {
      if (!control.value || control.hasError('pattern') || control.hasError('required')) {
        return of(null);
      }
      return timer(200).pipe(
        switchMap(() => this.auth.checkPhone(control.value)),
        map((res) => (res.exists ? { serverError: 'Phone number already in use' } : null)),
        catchError(() => of(null)),
      );
    };
  }

  get emailChecking() {
    return this.registerForm.get('email')?.status === 'PENDING';
  }

  get phoneChecking() {
    return this.registerForm.get('phone')?.status === 'PENDING';
  }

  onSubmit() {
    this.registerForm.markAllAsTouched();
    if (this.registerForm.invalid || this.registerForm.pending) return;

    this.serverError = '';
    this.loading = true;
    this.cdr.detectChanges();

    this.auth
      .register(this.registerForm.value)
      .pipe(timeout(8000))
      .subscribe({
        next: (res) => {
          this.loading = false;
          this.auth.saveAuth(res);
          this.snackBar.open('Account created successfully!', 'Close', {
            duration: 3000,
            panelClass: 'snack-success',
          });
          this.router.navigate(['/']);
        },
        error: (err) => {
          this.loading = false;
          // 409 is a safety net — async validators should have caught this already
          if (err.status === 409) {
            const field = err.error?.field;
            if (field === 'email') {
              this.registerForm.get('email')?.setErrors({ serverError: 'Email already registered' });
            } else if (field === 'phone') {
              this.registerForm.get('phone')?.setErrors({ serverError: 'Phone number already in use' });
            } else {
              this.serverError = err.error?.message ?? 'This email or phone is already registered.';
            }
          } else if (err.status === 429) {
            this.serverError = 'Too many attempts. Please wait a minute and try again.';
          } else if (err.status === 0 || err.name === 'TimeoutError') {
            this.serverError = 'Server not reachable. Please check your connection and try again.';
          } else {
            this.serverError = err.error?.message ?? 'Registration failed. Please try again.';
          }
          this.cdr.detectChanges();
        },
      });
  }
}
