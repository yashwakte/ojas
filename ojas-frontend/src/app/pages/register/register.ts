import { Component, ChangeDetectorRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import { timeout } from 'rxjs';

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

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {
    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  onSubmit() {
    if (this.registerForm.invalid) return;

    this.loading = true;
    this.auth
      .register(this.registerForm.value)
      .pipe(timeout(8000))
      .subscribe({
        next: (res) => {
          this.loading = false;
          this.cdr.detectChanges();
          this.auth.saveAuth(res);
          this.snackBar.open('Account created successfully! 🎉', 'Close', {
            duration: 3000,
            panelClass: 'snack-success',
          });
          this.router.navigate(['/']);
        },
        error: (err) => {
          this.loading = false;
          this.cdr.detectChanges();
          let msg = 'Registration failed. Please try again.';
          if (err.status === 429) {
            msg = 'Too many attempts. Please wait a minute.';
          } else if (err.status === 409) {
            msg = 'Email already registered';
          } else if (err.status === 0 || err.name === 'TimeoutError') {
            msg = 'Server not reachable. Please try later.';
          } else if (err.error?.message) {
            msg = err.error.message;
          }
          this.snackBar.open(msg, 'Close', {
            duration: 5000,
            panelClass: 'snack-error',
          });
        },
      });
  }
}
