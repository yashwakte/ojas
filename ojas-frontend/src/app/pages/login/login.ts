import { Component, ChangeDetectorRef, OnDestroy } from '@angular/core';
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
  selector: 'app-login',
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
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements OnDestroy {
  loginForm: FormGroup;
  loading = false;
  slowConnection = false;
  hidePassword = true;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  onSubmit() {
    if (this.loginForm.invalid) return;

    this.loading = true;
    this.slowConnection = false;

    // Show warm-up hint after 5s (Render free tier cold starts can take ~30s)
    this.slowTimer = setTimeout(() => {
      this.slowConnection = true;
      this.cdr.detectChanges();
    }, 5000);

    this.auth
      .login(this.loginForm.value)
      .pipe(timeout(35000))
      .subscribe({
        next: (res) => {
          this.clearSlowTimer();
          this.loading = false;
          this.slowConnection = false;
          this.cdr.detectChanges();
          this.auth.saveAuth(res);
          this.snackBar.open('Welcome back! 🎉', 'Close', {
            duration: 3000,
            panelClass: 'snack-success',
          });
          this.router.navigate(['/']);
        },
        error: (err) => {
          this.clearSlowTimer();
          this.loading = false;
          this.slowConnection = false;
          this.cdr.detectChanges();
          let msg = 'Something went wrong. Please try again.';
          if (err.status === 429) {
            msg = 'Too many attempts. Please wait a minute.';
          } else if (err.status === 401 || err.status === 400) {
            msg = 'Invalid email or password';
          } else if (err.status === 0 || err.name === 'TimeoutError') {
            msg = 'Server is taking too long. Please try again.';
          }
          this.snackBar.open(msg, 'Close', {
            duration: 5000,
            panelClass: 'snack-error',
          });
        },
      });
  }

  private clearSlowTimer() {
    if (this.slowTimer) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }

  ngOnDestroy() {
    this.clearSlowTimer();
  }
}
