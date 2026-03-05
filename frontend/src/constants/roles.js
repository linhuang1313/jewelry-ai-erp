/**
 * 用户角色配置
 */
import { Store, User, Package, Calculator, Scale, Briefcase, Crown } from 'lucide-react'

export const USER_ROLES = [
  { id: 'counter', name: '柜台', icon: Store, color: 'text-pink-600', bg: 'bg-pink-50' },
  { id: 'sales', name: '业务员', icon: User, color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'product', name: '商品专员', icon: Package, color: 'text-orange-600', bg: 'bg-orange-50' },
  { id: 'settlement', name: '结算专员', icon: Calculator, color: 'text-cyan-600', bg: 'bg-cyan-50' },
  { id: 'material', name: '料部', icon: Scale, color: 'text-yellow-600', bg: 'bg-yellow-50' },
  { id: 'finance', name: '财务', icon: Briefcase, color: 'text-green-600', bg: 'bg-green-50' },
  { id: 'manager', name: '管理层', icon: Crown, color: 'text-purple-600', bg: 'bg-purple-50' },
]

export const getRoleById = (id) => USER_ROLES.find(role => role.id === id)

export const getRoleName = (id) => {
  const role = getRoleById(id)
  return role ? role.name : id
}

