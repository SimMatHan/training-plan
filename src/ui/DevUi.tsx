// /dev/ui: alle primitiver i lys og mørk. Findes kun i dev-build (se App.tsx).
import { CalendarDots, ChartLineUp, GearSix, Lightning } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Category } from '../logic/category';
import { CATEGORY_LABEL } from '../logic/category';
import { wheelValues } from '../logic/wheel';
import { Avatar } from './Avatar';
import { PrimaryButton, SecondaryButton, SmallButton, TextButton } from './Button';
import { ExerciseRow, TILE_INSET } from './ExerciseRow';
import { ChoiceGrid, Switch, TextField } from './Field';
import { GradientPill, HeroNumber } from './HeroNumber';
import { IconTile } from './IconTile';
import { Card, Group, InsetList, InsetRow, RowText } from './InsetList';
import { LargeTitle } from './LargeTitle';
import { LineChart } from './LineChart';
import { Ring } from './Ring';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';
import { StatusLight } from './StatusLight';
import { TabBar } from './TabBar';
import { Wheel } from './Wheel';

const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
const POINTS = [12, 12.5, 13, 14, 14, 15, 16, 16, 17, 18].map((v, i) => ({ key: String(i), date: `2026-${String(8 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`, value: v }));

function Showcase() {
  const [seg, setSeg] = useState<'vaegt' | 'volumen'>('vaegt');
  const [kg, setKg] = useState<number | null>(16);
  const [reps, setReps] = useState<number | null>(8);
  const [on, setOn] = useState(true);
  const [rpe, setRpe] = useState<number | null>(7);
  const [sheet, setSheet] = useState(false);
  const [record, setRecord] = useState(false);

  return (
    <div className="bg-bg px-4 pb-10 text-ink">
      <LargeTitle title="I dag" subtitle="Uge 6 af 14, tærskelfase" accessory={<Avatar name="Simon" href="/dev/ui" />} />

      <Group title="Heltetal">
        <Card>
          <HeroNumber label="Sidst" value={record ? '18' : '16'} unit="kg" badge={record && <GradientPill>Ny rekord</GradientPill>} />
          <p className="mt-1 text-secondary text-ink-2">3 × 8/ben, RPE 7</p>
          <div className="mt-4 flex flex-col gap-2">
            <PrimaryButton onClick={() => setRecord((r) => !r)}>Start session</PrimaryButton>
            <SecondaryButton onClick={() => setSheet(true)}>Åbn sheet</SecondaryButton>
            <div className="flex gap-2">
              <SmallButton>Start</SmallButton>
              <SmallButton variant="primary">Fortsæt</SmallButton>
              <TextButton>Luk</TextButton>
              <TextButton danger>Slet</TextButton>
            </div>
          </div>
        </Card>
      </Group>

      <Group title="Øvelser">
        <InsetList inset={TILE_INSET}>
          <ExerciseRow category="legs" name="Enbens RDL" detail="3 × 8/ben, RPE 7" value="16 kg" sub="8 reps" href="/dev/ui" />
          <ExerciseRow category="back" name="Lat pulldown" detail="3 × 8, RPE 7" value="45 kg" sub="8 reps" href="/dev/ui" />
          <ExerciseRow category="calf" name="Enbens tåhæv" detail="3 × 12 H / 3 × 10 V" value="12 kg" sub="12 reps" href="/dev/ui" />
        </InsetList>
      </Group>

      <Group title="Kategorier">
        <div className="flex flex-wrap gap-3">
          {CATEGORIES.map((c) => (
            <span key={c} className="flex items-center gap-2 text-footnote text-ink-2">
              <IconTile category={c} />
              {CATEGORY_LABEL[c]}
            </span>
          ))}
        </div>
      </Group>

      <Group title="Kontroller">
        <Segmented
          label="Vis"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'vaegt', label: 'Vægt' },
            { value: 'volumen', label: 'Volumen' },
          ]}
        />
        <Card className="mt-3 flex items-center gap-3">
          <span className="text-row">Sæt 1</span>
          <Wheel className="w-20" label="kg" decimal values={wheelValues({ value: kg, step: 0.5 })} value={kg} onChange={setKg} />
          <span className="text-secondary text-ink-2">kg</span>
          <Wheel className="w-16" label="reps" values={wheelValues({ value: reps, step: 1, floor: 30 })} value={reps} onChange={setReps} />
          <span className="text-secondary text-ink-2">reps</span>
        </Card>
        <Card className="mt-3">
          <Switch label="Højre og venstre hver for sig" checked={on} onChange={setOn} />
          <TextField label="Navn" placeholder="Fx Karo" />
          <div className="mt-3">
            <ChoiceGrid label="RPE" columns={5} options={[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]} value={rpe} onChange={setRpe} format={(v) => String(v).replace('.', ',')} />
          </div>
        </Card>
      </Group>

      <Group title="Ring og status">
        <Card className="flex items-center gap-5">
          <Ring progress={0.75} size={110} label="3 af 4 sessioner">
            <span className="num text-title">3/4</span>
          </Ring>
          <div className="flex flex-col gap-1">
            <StatusLight light="grøn" />
            <StatusLight light="gul" />
            <StatusLight light="rød" />
            <StatusLight light="afventer" />
          </div>
        </Card>
      </Group>

      <Group title="Graf">
        <Card>
          <LineChart label="Topvægt" unit="kg" points={POINTS} />
        </Card>
      </Group>

      <Group title="Liste">
        <InsetList>
          <InsetRow onClick={() => undefined}>
            <RowText title="Version 3" detail="fra Claude · 7. okt. 2026" />
          </InsetRow>
          <InsetRow>
            <RowText title="Venstre lyske" />
          </InsetRow>
        </InsetList>
      </Group>

      <div className="relative h-24 overflow-hidden rounded-card [transform:translateZ(0)]">
        <TabBar
          tabs={[
            { href: '/dev/ui', label: 'I dag', icon: Lightning, active: true },
            { href: '/dev/ui', label: 'Uge', icon: CalendarDots, active: false },
            { href: '/dev/ui', label: 'Historik', icon: ChartLineUp, active: false },
            { href: '/dev/ui', label: 'Indstillinger', icon: GearSix, active: false },
          ]}
        />
      </div>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Bundark">
        <p className="mb-4 text-body">Glider op på 240 ms.</p>
        <PrimaryButton onClick={() => setSheet(false)}>OK</PrimaryButton>
      </Sheet>
    </div>
  );
}

export default function DevUi() {
  return (
    <div className="grid md:grid-cols-2">
      <div data-theme="light">
        <Showcase />
      </div>
      <div data-theme="dark">
        <Showcase />
      </div>
    </div>
  );
}
