import pb from '@/lib/pocketbase/client'
import { Customer } from '@/types/crm'

export const getCustomers = () => pb.collection<Customer>('customers').getFullList({ sort: 'name' })

export const getCustomer = (id: string) => pb.collection<Customer>('customers').getOne(id)

export const createCustomer = (data: Partial<Customer>) =>
  pb.collection<Customer>('customers').create(data)

export const updateCustomer = (id: string, data: Partial<Customer>) =>
  pb.collection<Customer>('customers').update(id, data)

export const deleteCustomer = (id: string) => pb.collection('customers').delete(id)
