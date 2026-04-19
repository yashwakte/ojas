import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-offers',
  imports: [MatIconModule],
  template: `
    <div class="offers-page">
      <div class="coming-soon">
        <mat-icon>local_offer</mat-icon>
        <h2>Offers &amp; Deals</h2>
        <p>Exciting offers are on the way! Stay tuned.</p>
      </div>
    </div>
  `,
  styles: [
    `
      .offers-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 90px 24px 40px;
      }
      .coming-soon {
        text-align: center;
        color: var(--ojas-text-light);
        mat-icon {
          font-size: 4rem;
          width: 4rem;
          height: 4rem;
          color: var(--ojas-orange);
          display: block;
          margin: 0 auto 16px;
        }
        h2 {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--ojas-text);
          font-family: 'Poppins', sans-serif;
          margin: 0 0 8px;
        }
        p {
          margin: 0;
          font-size: 0.95rem;
        }
      }
    `,
  ],
})
export class Offers {}
