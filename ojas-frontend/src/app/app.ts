import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  constructor(private auth: AuthService) {}

  ngOnInit() {
    this.auth.ping();

    if (this.auth.isLoggedIn()) {
      this.auth.validateSession().subscribe({ error: () => {} });
    }
  }
}
