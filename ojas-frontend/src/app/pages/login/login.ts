import { Component } from '@angular/core';
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
export class Login {
  loginForm: FormGroup;
  loading = false;
  hidePassword = true;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  onSubmit() {
    if (this.loginForm.invalid) return;

    this.loading = true;
    this.auth.login(this.loginForm.value).pipe(timeout(10000)).subscribe({
      next: (res) => {
        this.loading = false;
        this.auth.saveAuth(res);
        this.snackBar.open('Welcome back! 🎉', 'Close', { duration: 3000 });
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading = false;
        if (err.status === 429) {
          this.snackBar.open('Too many attempts. Please wait a minute.', 'Close', { duration: 5000 });
        } else if (err.status === 401) {
          this.snackBar.open('Invalid email or password', 'Close', { duration: 3000 });
        } else if (err.status === 0 || err.name === 'TimeoutError') {
          this.snackBar.open('Server not reachable. Please try later.', 'Close', { duration: 4000 });
        } else {
          this.snackBar.open('Something went wrong. Please try again.', 'Close', { duration: 3000 });
        }
      },
    });
  }
}
