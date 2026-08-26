<script setup lang="ts">
import {computed} from 'vue'
import {Activity, ChevronLeft, ChevronRight, Cpu, Gauge, Navigation2} from 'lucide-vue-next'
import {useI18n} from 'vue-i18n'
import type {SEIDataPoint} from '../types/tesla'

const props = defineProps<{
    data: SEIDataPoint | null
    hasMetadata: boolean
    dateText: string
    timeText: string
    locationText: string
}>()
const {t} = useI18n()

const speed = computed(() => props.data ? Math.round(props.data.speedKph) : '--')
const throttle = computed(() => Math.max(0, Math.min(100, props.data?.throttlePct ?? 0)))
const brake = computed(() => Math.max(0, Math.min(100, props.data?.brakePct ?? 0)))
const hasGps = computed(() => Boolean(
    props.data
    && Number.isFinite(props.data.latitude)
    && Number.isFinite(props.data.longitude)
    && (props.data.latitude !== 0 || props.data.longitude !== 0),
))
const heading = computed(() => {
    const rawHeading = props.data?.headingDeg
    if (rawHeading === null || rawHeading === undefined || !Number.isFinite(rawHeading)) {
        return t('telemetry.notRecorded')
    }
    const value = ((rawHeading % 360) + 360) % 360
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    return `${Math.round(value)}° ${directions[Math.round(value / 45) % 8]}`
})
const driverMode = computed(() => {
    switch (props.data?.apStatus) {
        case 'FSD': return {label: t('telemetry.modeFsd'), detail: 'FSD', tone: 'fsd'}
        case 'AP': return {label: t('telemetry.modeAutosteer'), detail: 'AP / EAP', tone: 'ap'}
        case 'TACC': return {label: t('telemetry.modeTacc'), detail: 'TACC', tone: 'tacc'}
        case 'OFF': return {label: t('telemetry.modeManual'), detail: 'OFF', tone: 'manual'}
        default: return {label: t('telemetry.modeUnknown'), detail: '--', tone: 'unknown'}
    }
})
</script>

<template>
  <section class="dashboard" :class="{'dashboard--idle': !hasMetadata}">
    <div class="dashboard__primary">
      <div class="context block">
        <Gauge :size="18" />
        <div>
          <strong>{{ dateText }} <span>{{ timeText }}</span></strong>
          <small :title="locationText">{{ locationText }}</small>
        </div>
      </div>
      <div class="speed block"><strong>{{ speed }}</strong><span>km/h</span></div>
      <div class="gears block" :aria-label="t('telemetry.gear')">
        <span v-for="gear in ['P', 'R', 'N', 'D']" :key="gear" :class="{'is-active': data?.gear === gear}">{{ gear }}</span>
      </div>
      <div class="metric block">
        <span>{{ t('telemetry.steering') }}</span>
        <strong>{{ data ? `${Math.round(data.steeringAngleDeg)}°` : '--°' }}</strong>
      </div>
      <div class="drive-mode block" :class="`drive-mode--${driverMode.tone}`">
        <span>{{ t('telemetry.driverMode') }}</span>
        <strong>{{ driverMode.label }}</strong>
        <small>{{ driverMode.detail }} · {{ t('telemetry.rawCode') }} {{ data?.autopilotState ?? '--' }}</small>
      </div>
      <div class="pedals block">
        <span>{{ t('telemetry.throttle') }}</span><div class="meter"><b :style="{width: `${throttle}%`}" /></div><em>{{ data ? Math.round(throttle) : '--' }}%</em>
        <span class="pedals__brake">{{ t('telemetry.brake') }}</span><div class="meter meter--brake"><b :style="{width: `${brake}%`}" /></div><em>{{ data ? Math.round(brake) : '--' }}%</em>
      </div>
    </div>

    <div class="dashboard__details">
      <div class="detail signals">
        <span>{{ t('telemetry.signals') }}</span>
        <ChevronLeft :size="17" :class="{'is-on': data?.blinkerLeft}" />
        <ChevronRight :size="17" :class="{'is-on': data?.blinkerRight}" />
      </div>
      <div class="detail"><Navigation2 :size="15" /><span>{{ t('telemetry.heading') }}</span><strong>{{ heading }}</strong></div>
      <div class="detail gps">
        <span>GPS</span>
        <strong v-if="hasGps">{{ data!.latitude!.toFixed(6) }}, {{ data!.longitude!.toFixed(6) }}</strong>
        <strong v-else>{{ t('telemetry.notRecorded') }}</strong>
      </div>
      <div class="detail acceleration">
        <Activity :size="15" /><span>{{ t('telemetry.acceleration') }}</span>
        <strong>X {{ data?.accelerationX.toFixed(3) ?? '--' }}</strong>
        <strong>Y {{ data?.accelerationY.toFixed(3) ?? '--' }}</strong>
        <strong>Z {{ data?.accelerationZ.toFixed(3) ?? '--' }} m/s²</strong>
      </div>
      <div class="detail packet">
        <Cpu :size="15" /><span>SEI</span><strong>v{{ data?.seiVersion ?? '--' }}</strong>
        <span>{{ t('telemetry.frame') }}</span><strong>{{ data?.frameSequence ?? '--' }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dashboard { background: #0d0f0f; border-top: 1px solid #292c2c; container-type: inline-size; flex: 0 0 auto; min-width: 0; }
.dashboard--idle { opacity: .72; }
.dashboard__primary, .dashboard__details { display: grid; min-width: 0; }
.dashboard__primary { align-items: stretch; grid-template-columns: minmax(185px, 1.2fr) 88px auto 105px minmax(145px, auto) minmax(250px, 1.5fr); min-height: 54px; }
.dashboard__details { align-items: center; border-top: 1px solid #202323; grid-template-columns: auto auto minmax(210px, 1fr) minmax(300px, 1.25fr) auto; min-height: 38px; }
.block, .detail { border-right: 1px solid #282b2b; min-width: 0; }
.block { align-items: center; display: flex; padding: 8px 12px; }
.block:last-child, .detail:last-child { border-right: 0; }
.context { gap: 10px; }
.context > svg { color: #e82127; flex: 0 0 auto; }
.context > div { display: grid; gap: 3px; min-width: 0; }
.context strong { color: #eef0f0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.context strong span { font-variant-numeric: tabular-nums; }
.context small { color: #777e7e; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.speed { align-items: baseline; gap: 5px; justify-content: center; }
.speed strong { color: #27d565; font-size: 23px; font-variant-numeric: tabular-nums; }
.speed span, .metric span, .pedals > span, .drive-mode > span, .detail > span { color: #697070; font-size: 9px; font-weight: 600; }
.gears { gap: 3px; justify-content: center; }
.gears span { align-items: center; background: #242727; border-radius: 4px; color: #646b6b; display: flex; font-size: 11px; font-weight: 700; height: 28px; justify-content: center; width: 27px; }
.gears span.is-active { background: #128b43; color: #fff; }
.metric { gap: 8px; justify-content: center; white-space: nowrap; }
.metric strong { color: #c2c7c7; font-family: ui-monospace, monospace; font-size: 13px; }
.drive-mode { align-content: center; align-items: flex-start; background: #171a1a; display: grid; gap: 1px; }
.drive-mode strong { color: #aeb4b4; font-size: 11px; line-height: 1.2; white-space: nowrap; }
.drive-mode small { color: #626969; font-family: ui-monospace, monospace; font-size: 8px; white-space: nowrap; }
.drive-mode--manual strong { color: #b8bdbd; }
.drive-mode--ap { background: #10243a; }
.drive-mode--ap strong { color: #73b8ff; }
.drive-mode--fsd { background: #2a1d40; }
.drive-mode--fsd strong { color: #c3a5ff; }
.drive-mode--tacc { background: #342d17; }
.drive-mode--tacc strong { color: #e5c361; }
.pedals { display: grid; gap: 5px 7px; grid-template-columns: auto minmax(55px, 1fr) 34px; }
.meter { background: #292c2c; height: 6px; min-width: 0; overflow: hidden; }
.meter b { background: #22c55e; display: block; height: 100%; }
.meter--brake b { background: #e82127; }
.pedals__brake { color: #e82127 !important; }
.pedals em { color: #858b8b; font-size: 9px; font-style: normal; text-align: right; }
.detail { align-items: center; color: #737a7a; display: flex; font-size: 9px; gap: 7px; min-height: 38px; padding: 5px 12px; }
.detail strong { color: #b9bebe; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 500; white-space: nowrap; }
.signals svg { color: #434949; }
.signals svg.is-on { color: #36d978; filter: drop-shadow(0 0 4px #36d97888); }
.gps strong { overflow: hidden; text-overflow: ellipsis; }
.acceleration { justify-content: center; }
.packet { justify-content: flex-end; }
@container (max-width: 1040px) {
  .dashboard__primary { grid-template-columns: minmax(180px, 1fr) 82px auto minmax(115px, .65fr); }
  .drive-mode { border-top: 1px solid #282b2b; grid-column: 1 / 2; }
  .pedals { border-top: 1px solid #282b2b; grid-column: 2 / -1; }
  .dashboard__details { grid-template-columns: auto auto minmax(220px, 1fr); }
  .acceleration { border-top: 1px solid #282b2b; grid-column: 1 / 3; justify-content: flex-start; }
  .packet { border-top: 1px solid #282b2b; grid-column: 3; }
}
@container (max-width: 650px) {
  .dashboard__primary { grid-template-columns: minmax(170px, 1fr) 80px; }
  .gears, .metric { border-top: 1px solid #282b2b; }
  .gears { grid-column: 1; }
  .metric { grid-column: 2; }
  .drive-mode { grid-column: 1; }
  .pedals { grid-column: 2; grid-template-columns: auto minmax(35px, 1fr) 32px; }
  .dashboard__details { grid-template-columns: 1fr 1fr; }
  .gps, .acceleration, .packet { border-top: 1px solid #282b2b; }
  .gps { grid-column: 1 / -1; }
  .acceleration { grid-column: 1 / -1; }
  .packet { grid-column: 1 / -1; justify-content: flex-start; }
}
</style>
