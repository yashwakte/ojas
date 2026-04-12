import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-footer',
  imports: [RouterLink, MatIconModule],
  templateUrl: './footer.html',
  styleUrl: './footer.scss'
})
export class Footer {
  currentYear = new Date().getFullYear();
}
