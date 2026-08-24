<!--
 * LockPass 根组件（Vue 3）
 * 认证视图 / 主界面切换
-->
<script setup>
/* LockPass — 根组件：认证视图 / 主界面切换 */
import { onMounted } from 'vue'
import { useVault, vaultState } from './composables/useVault'
import { useShortcuts } from './composables/useShortcuts'
import AuthView from './components/auth/AuthView.vue'
import AppShell from './components/AppShell.vue'
import ModalHost from './components/ModalHost.vue'

const { boot } = useVault()
useShortcuts()

onMounted(() => {
  boot()
})
</script>

<template>
  <div id="app-root">
    <AuthView v-if="!vaultState.isUnlocked" />
    <AppShell v-else />
    <ModalHost />
    <!-- Toast 挂载点（与原生版 template.js 保持一致，showToast 依赖此容器） -->
    <div id="toast-container"></div>
  </div>
</template>
