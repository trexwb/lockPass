<!--
 * LockPass — 局域网同步服务弹窗（设计文档 docs/multi-device-sync-design.md §8）
 * 两个视图：A 侧「开启服务」显示 地址 + 端口 + 一次性口令 + 倒计时；
 *           B 侧「连接对端」填 地址 + 端口 + 口令 → 预览 → 四步进度 → 结果页。
-->
<script setup>
/* LockPass — 局域网同步服务：开启服务 / 连接对端 */
import { computed } from 'vue'
import ModalBase from '../common/ModalBase.vue'
import { useSyncService } from '../../composables/useSyncService'
import { vaultState } from '../../composables/useVault'

const emit = defineEmits(['close'])
const { s, prepareHost, startHost, stopHost, enterClient, connect, runSync } = useSyncService()

const t = (k, p) => window.I18n.t(k, p)

/** 当前进度文案 */
const stepLabel = computed(() => {
  if (!s.step) return ''
  const map = {
    auth: 'syncService.step.auth',
    pull: 'syncService.step.pull',
    merge: 'syncService.step.merge',
    push: 'syncService.step.push',
    done: 'syncService.step.done',
  }
  return t(map[s.step] || 'syncService.step.done')
})

const progressPct = computed(() => {
  const order = ['auth', 'pull', 'merge', 'push', 'done']
  const i = order.indexOf(s.step)
  return i < 0 ? 0 : Math.round(((i + 1) / order.length) * 100)
})

/** 口令按字符拆分展示：大号、逐位可核对（6 位数字） */
const passcodeChars = computed(() => String(s.passcode || '').split(''))

/** 地址串（对端要填的完整值） */
const hostAddr = computed(() => (s.server ? `${s.server.bindIp}:${s.server.port}` : ''))

const travelBlocked = computed(() => vaultState.travelMode)

async function onHost() {
  if (travelBlocked.value) {
    s.error = t('syncService.err.travelMode')
    return
  }
  await prepareHost()
}

async function onConnect() {
  const ok = await connect()
  if (!ok) return
}

async function onSync() {
  await runSync()
}

function close() {
  if (s.server) stopHost()
  emit('close')
}
</script>

<template>
  <ModalBase :aria-label="t('syncService.title')" max-width="560px" @close="close">
    <div class="modal-header">
      <h2>{{ t('syncService.title') }}</h2>
      <button class="btn-icon" :aria-label="t('pwgen.close')" @click="close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="modal-body sync-service-body">
      <p class="sync-subtitle">{{ t('syncService.subtitle') }}</p>

      <p v-if="s.error" class="sync-error" role="alert">{{ s.error }}</p>

      <!-- ── 角色选择 ── -->
      <div v-if="s.mode === 'menu'" class="sync-menu">
        <button class="sync-menu-item" :disabled="!s.canHost || travelBlocked" @click="onHost">
          <div class="sync-menu-main">{{ t('syncService.menu.host') }}</div>
          <div class="sync-menu-desc">{{ t('syncService.menu.hostDesc') }}</div>
        </button>
        <button class="sync-menu-item" @click="enterClient()">
          <div class="sync-menu-main">{{ t('syncService.menu.client') }}</div>
          <div class="sync-menu-desc">{{ t('syncService.menu.clientDesc') }}</div>
        </button>
        <p v-if="!s.canHost" class="sync-hint">{{ t('syncService.menu.browserOnly') }}</p>
        <p v-if="travelBlocked" class="sync-hint sync-hint-warn">{{ t('syncService.err.travelMode') }}</p>
      </div>

      <!-- ── A 侧：开启服务 ── -->
      <div v-else-if="s.mode === 'host'" class="sync-host">
        <div v-if="!s.server">
          <label class="sync-label">{{ t('syncService.host.ipLabel') }}</label>
          <select v-model="s.selectedIp" class="sync-input" :disabled="s.busy || !s.ips.length">
            <option v-for="ip in s.ips" :key="ip" :value="ip">{{ ip }}</option>
          </select>
          <p v-if="!s.ips.length" class="sync-hint">{{ t('syncService.host.noIp') }}</p>

          <label class="sync-label">{{ t('syncService.host.passLabel') }}</label>
          <div class="sync-passcode">
            <span v-for="(ch, i) in passcodeChars" :key="i" class="sync-digit">{{ ch }}</span>
          </div>
          <p class="sync-hint">{{ t('syncService.host.passHint') }}</p>
        </div>

        <div v-else class="sync-running">
          <label class="sync-label">{{ t('syncService.host.addr') }}</label>
          <div class="sync-addr">{{ hostAddr }}</div>
          <div class="sync-addr-row">
            <span class="sync-chip">{{ t('syncService.host.port') }} {{ s.server.port }}</span>
            <span class="sync-chip">{{ t('syncService.host.countdown', { sec: s.countdown }) }}</span>
          </div>
          <label class="sync-label">{{ t('syncService.host.passLabel') }}</label>
          <div class="sync-passcode">
            <span v-for="(ch, i) in passcodeChars" :key="i" class="sync-digit">{{ ch }}</span>
          </div>
          <p class="sync-hint">{{ t('syncService.host.waiting') }}</p>
          <p class="sync-hint">{{ t('syncService.host.keepOpen') }}</p>
        </div>
      </div>

      <!-- ── B 侧：连接对端 ── -->
      <div v-else class="sync-client">
        <template v-if="!s.result">
          <label class="sync-label">{{ t('syncService.client.ipLabel') }}</label>
          <input v-model="s.remoteIp" class="sync-input" autocomplete="off" spellcheck="false" :disabled="s.busy"
            placeholder="192.168.1.20" />

          <label class="sync-label">{{ t('syncService.client.portLabel') }}</label>
          <input v-model.number="s.remotePort" class="sync-input" type="number" min="1" max="65535"
            :disabled="s.busy" />

          <label class="sync-label">{{ t('syncService.client.passLabel') }}</label>
          <input v-model="s.remotePass" class="sync-input sync-input-code" inputmode="numeric"
            autocomplete="one-time-code" :maxlength="6" :disabled="s.busy"
            :placeholder="t('syncService.client.passPh')" />

          <p class="sync-hint">{{ t('syncService.client.prereq') }}</p>

          <div v-if="s.preview" class="sync-preview">
            <div class="sync-preview-title">{{ t('syncService.client.previewTitle') }}</div>
            <div class="sync-preview-row">{{ t('syncService.client.rev', { rev: s.preview.rev }) }}</div>
            <div class="sync-preview-row sync-dim">{{ s.preview.deviceId }}</div>
            <p v-if="s.preview.skewWarn" class="sync-hint sync-hint-warn">{{ t('syncService.client.skewWarn') }}</p>
          </div>
        </template>

        <!-- 结果页 -->
        <div v-else class="sync-result">
          <div class="sync-result-title">{{ t('syncService.result.title') }}</div>
          <div class="sync-preview-row">
            {{ t('syncService.result.summary', {
              added: s.result.summary.added,
              updated: s.result.summary.updated,
              removed: s.result.summary.removed,
              restored: s.result.summary.restored,
            }) }}
          </div>
          <div v-if="s.result.summary.conflicts" class="sync-preview-row sync-warn-row">
            {{ t('syncService.result.conflicts', { n: s.result.summary.conflicts }) }}
          </div>
          <div v-if="s.result.summary.tagConflicts" class="sync-preview-row">
            {{ t('syncService.result.tagConflicts', { n: s.result.summary.tagConflicts }) }}
          </div>
          <p class="sync-hint">{{ t('syncService.result.bothSides') }}</p>
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <!-- 进度条：四步（鉴权 → 拉取 → 合并 → 回写） -->
      <div v-if="s.busy && s.step" class="sync-progress">
        <div class="sync-progress-bar"><div class="sync-progress-fill" :style="{ width: progressPct + '%' }"></div></div>
        <span class="sync-progress-label">{{ stepLabel }}</span>
      </div>

      <button v-if="s.mode !== 'menu'" class="btn btn-secondary" :disabled="s.busy" @click="s.mode = 'menu'; s.error = ''">
        {{ t('syncService.back') }}
      </button>

      <template v-if="s.mode === 'host'">
        <button v-if="!s.server" class="btn btn-primary" :disabled="s.busy || !s.selectedIp" @click="startHost()">
          {{ t('syncService.host.start') }}
        </button>
        <button v-else class="btn btn-danger" :disabled="s.busy" @click="stopHost()">
          {{ t('syncService.host.stop') }}
        </button>
      </template>

      <template v-else-if="s.mode === 'client' && !s.result">
        <button v-if="!s.preview" class="btn btn-primary" :disabled="s.busy || !s.remoteIp || !s.remotePass"
          @click="onConnect()">
          {{ t('syncService.client.connect') }}
        </button>
        <button v-else class="btn btn-primary" :disabled="s.busy" @click="onSync()">
          {{ t('syncService.client.sync') }}
        </button>
      </template>

      <button v-else-if="s.result" class="btn btn-primary" @click="close">{{ t('syncService.step.done') }}</button>
    </div>
  </ModalBase>
</template>
