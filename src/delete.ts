import { mapValues, shuffle } from 'lodash';

export class Frog {
  sex: 'M' | 'F';
  constructor(sex: 'M' | 'F') {
    this.sex = sex;
  }
}

const score: Record<string, number> = {
  MM: 0,
  MF: 0,
  FM: 0,
  FF: 0,
};

let i = 0;
while (i < 100000) {
  // Create frogs. One frog is already known to be male.
  const frog_1 = new Frog('M');
  const frog_2 = new Frog(Math.random() > 0.5 ? 'M' : 'F');
  const frogs = shuffle([frog_1, frog_2]);
  // Add this set to the score count.
  score[frogs[0].sex + frogs[1].sex]++;
  i++;
}

// Calculate percentages.
const total = score.MM + score.MF + score.FM + score.FF;
const percentages = mapValues(
  score,
  (val: number) => `${((val / total) * 100).toFixed(2)}%`
);

// Print results.
console.log(JSON.stringify(percentages, null, 2));
